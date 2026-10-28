from datetime import date
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import io
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from unittest import TestCase
from unittest.mock import patch
from urllib.error import URLError

import app as web
from auth_store import AuthStore
from .exchange_rate import ExchangeRateLookupError, fetch_usd_npr_rate
from .exporters import build_payload
from .generator import recalculate_edited_statement
from . import test_import_checks as imported


class ExportNetworkTests(TestCase):
    def form(self):
        return {**web.default_form_values(), 'customer_name': 'SAMPLE Network Test',
                'start_date': '2024-10-01', 'end_date': '2024-10-21', 'opening_balance': '365000',
                'target_closing_balance': '379742',
                'interest_rate': '10', 'tax_rate': '6', 'include_cheque_column': 'No',
                'interest_text': 'Interest', 'tax_text': 'Tax', 'rate_mode': 'Auto (NRB)', 'manual_rate': ''}

    def test_nrb_network_errors_become_actionable_exchange_rate_errors(self):
        for error in (URLError(TimeoutError('timed out')), TimeoutError('timed out'), URLError('DNS lookup failed')):
            with self.subTest(error=type(error).__name__), patch('statement_generator.exchange_rate.urlopen', side_effect=error):
                with self.assertRaisesRegex(ExchangeRateLookupError, 'manual.*rate'):
                    fetch_usd_npr_rate(date(2024, 10, 22))

    def test_statement_payload_does_not_invent_an_exchange_rate_or_usd_balance(self):
        config=imported.ImportCheckTests().config()
        result=recalculate_edited_statement(config, imported.ImportCheckTests().posting_rows(), True)
        payload=build_payload(config, result, None, True)
        self.assertEqual(payload['summary']['final_balance'], '379742.00')
        self.assertEqual(payload['rates']['usd_npr'], '')
        self.assertEqual(payload['certificate']['equivalent_usd'], '')
        self.assertEqual(payload['certificate']['balance_words_usd'], '')

    def test_offline_statement_downloads_and_certificate_manual_rate_recovery(self):
        with TemporaryDirectory() as temp:
            root=Path(temp)
            auth=AuthStore(root/'auth.db')
            user=auth.create_user('offline-export','temporary-export-password','user','check_only',full_name='SAMPLE',mobile_number='000000')
            token=auth.login(user.username,'temporary-export-password')['token']
            form=self.form()
            class Handler(web.StatementWebHandler):
                def log_message(self,*_args): pass
            with patch.object(web,'AUTH_STORE',auth), patch.object(web,'STATE_FILE',root/'state.json'), \
                    patch.object(web,'USER_STATE_ROOT',root/'users'), patch.object(web,'WEB_TEMP_ROOT',root/'runtime'):
                config=web.build_config(form,user_id=user.id)
                result=recalculate_edited_statement(config,imported.ImportCheckTests().posting_rows(),True)
                serialized=web.serialize_result(config,result)
                saved=auth.save_statement(user,serialized,form,None,'imported',False)
                payload={'config':form,'result_payload':serialized,'statement_id':saved['statement_id'],
                         'source_type':'imported','export_kind':'statement','export_mode':'normal'}
                server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
                thread=Thread(target=server.serve_forever,daemon=True);thread.start()
                def post(value):
                    connection=HTTPConnection(*server.server_address,timeout=5)
                    try:
                        connection.request('POST','/api/export',json.dumps(value),{'Content-Type':'application/json','Authorization':f'Bearer {token}'})
                        response=connection.getresponse();body=response.read()
                        return response.status,response.getheader('Content-Disposition',''),body
                    finally: connection.close()
                try:
                    with patch('statement_generator.exchange_rate.urlopen',side_effect=URLError(TimeoutError('timed out'))) as network:
                        for file_type in ('excel','word'):
                            status,header,body=post({**payload,'statement_file_type':file_type})
                            self.assertEqual(status,200,body)
                            self.assertIn('.docx' if file_type=='word' else '.xlsx',header)
                            self.assertTrue(body.startswith(b'PK'))
                            if file_type=='word':
                                from docx import Document
                                document=Document(io.BytesIO(body));text='\n'.join(cell.text for table in document.tables for row in table.rows for cell in row.cells)
                                self.assertIn('379,742',text);self.assertIn('Transfer in',text)
                            else:
                                from openpyxl import load_workbook
                                workbook=load_workbook(io.BytesIO(body));values=[cell.value for row in workbook.active for cell in row]
                                self.assertIn(379742,values);self.assertIn('Transfer in',values);workbook.close()
                        network.assert_not_called()
                        # Selected-format export and print preview must also avoid NRB.
                        source=root/'template.xlsx';source.write_bytes(b'local-template')
                        def export_template(_source,target,export_payload):
                            self.assertEqual(export_payload['summary']['final_balance'],'379742.00')
                            target.write_bytes(b'SAMPLE formatted statement')
                        with patch.object(web,'resolve_template_entry',return_value=web.TemplateEntry('Local',source)), \
                                patch.object(web,'editable_office_copy',return_value=source), \
                                patch.object(web,'export_statement',side_effect=export_template), \
                                patch.object(web,'build_excel_preview_html_bytes',return_value=b'<html>SAMPLE preview</html>'):
                            for preview in (False,True):
                                status,_,body=post({**payload,'export_mode':'template','template_name':'Local','print_preview_html':preview})
                                self.assertEqual(status,200,body)
                        network.assert_not_called()
                        with patch.object(web.traceback,'print_exc'):
                            status,_,body=post({**payload,'export_kind':'certificate'})
                        self.assertEqual(status,400,body)
                        error=json.loads(body)
                        self.assertTrue(error.get('requires_manual_rate'),error)
                        self.assertNotIn('urlopen',error['error'])
                        self.assertIn('manual',error['error'].lower())
                        for extra in ({'rate_mode':'Manual','manual_rate':'140'}, {'manual_rate':'140'}):
                            status,_,body=post({**payload,'export_kind':'certificate',**extra})
                            self.assertEqual(status,200,body)
                            from docx import Document
                            text='\n'.join(p.text for p in Document(io.BytesIO(body)).paragraphs)
                            self.assertIn('2,712.44',text)
                finally:
                    server.shutdown();server.server_close();thread.join(timeout=5)
