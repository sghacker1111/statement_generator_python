from dataclasses import replace
from itertools import permutations
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

import app as web
from auth_store import AuthStore
from .descriptions import compose, parts, profile_message
from .generator import validate_edited_statement, _imported_check_rows
from . import test_import_checks as imported


class WorkspaceTests(TestCase):
    def test_creating_an_imported_profile_preserves_existing_names_and_all_settings(self):
        with TemporaryDirectory() as temp:
            store = AuthStore(Path(temp) / 'profiles.db')
            user = store.create_user('profile-user', 'temporary-password', 'user', 'check_only', full_name='Profile User', mobile_number='000000')
            profile = {'account_number': '00001234', 'deposit_text': 'Cash Deposited BY:', 'deposit_names': 'First\nSecond',
                       'amount_rounding_percentages': '{"500":70,"50":20,"5":10}', 'statement_template_name': 'Uploaded format'}
            store.save_profile_format(user, 'External profile', profile, create_only=True)
            with self.assertRaisesRegex(ValueError, 'already uses that name'):
                store.save_profile_format(user, 'external PROFILE', {'deposit_text': 'Must not replace'}, create_only=True)
            self.assertEqual(store.load_profile_format(user, 'External profile')['profile'], profile)
            updated = store.save_profile_format(user, 'External profile', {**profile, 'deposit_text': 'Updated label'}, original_name='External profile')
            self.assertEqual(updated['profile']['account_number'], '00001234')
            self.assertEqual(updated['profile']['deposit_text'], 'Updated label')

    def test_description_check_scopes_ignore_names_and_validate_the_amount_side(self):
        from types import SimpleNamespace
        from dataclasses import asdict
        config = SimpleNamespace(**asdict(imported.ImportCheckTests().config()))
        config.deposit_text = 'Cash Deposit'
        config.withdrawal_text = 'Cash Withdraw'
        config.description_extra_text = 'Branch Transfer'
        config.deposit_description_parts = '["label","name","extra"]'
        config.withdrawal_description_parts = '["label","name","extra"]'
        for scope in ('labels', 'labels_extra'):
            config.description_check_scope = scope
            for side, label in [('deposit', 'Cash Deposit'), ('withdrawal', 'Cash Withdraw')]:
                other = 'Cash Withdraw' if side == 'deposit' else 'Cash Deposit'
                for text in (f'Branch Transfer: {label} BY: A Different Person / reference 123',
                             f'{label}   Branch   Transfer', f'{label}: Branch Transfer / Another Name'):
                    self.assertEqual(profile_message(config, side, text), '', (scope, text))
                for changed_case in (label.lower(), label.upper(), label.swapcase()):
                    self.assertTrue(profile_message(config, side, f'{changed_case} Branch Transfer Person'))
                self.assertTrue(profile_message(config, side, f'{other} Branch Transfer Person'))
                self.assertTrue(profile_message(config, side, f'{label} {other} Branch Transfer'))
                self.assertTrue(profile_message(config, side, f'{label}ed Branch Transfer'))
                self.assertEqual(bool(profile_message(config, side, f'{label} Random Name')), scope == 'labels_extra')
        config.description_check_scope = 'labels'
        self.assertTrue(profile_message(config, 'interest', 'Wrong posting text'))

    def test_description_orders_connectors_and_legacy(self):
        config = replace(imported.ImportCheckTests().config(), deposit_name_mode='name_plus_label', deposit_text='Cash Deposit', description_extra_text='Reference')
        self.assertEqual(compose(config, 'deposit', 'Samir'), 'Samir Cash Deposit')  # existing default Name + Label
        config = replace(config, deposit_name_mode='label_plus_name')
        self.assertEqual(compose(config, 'deposit', 'Samir'), 'Cash Deposit by Samir')
        for size in (1, 2, 3):
            for order in permutations(('name', 'label', 'extra'), size):
                config = replace(config, deposit_description_parts=list(order), deposit_connector_enabled='no')
                actual = compose(config, 'deposit', 'Samir')
                expected = ' '.join({'name':'Samir','label':'Cash Deposit','extra':'Reference'}[part] for part in order)
                self.assertEqual(actual, expected)
                self.assertEqual(profile_message(config, 'deposit', actual), '')
        for connector in ('by', 'BY', 'By', 'By:'):
            config = replace(config, deposit_description_parts='["label","name","extra"]', deposit_connector_enabled='yes', deposit_connector_text=connector)
            self.assertEqual(compose(config, 'deposit', 'Samir'), f'Cash Deposit {connector} Samir Reference')
            self.assertTrue(profile_message(config, 'deposit', 'Cash Deposit Wrong Samir'))
        for value in ('[]', '["none"]', '["name","name"]', '[["name"]]', '[2]', 'invalid'):
            with self.assertRaises(ValueError): parts(value)

    def test_imported_description_options_use_debit_credit_and_keep_system_checks(self):
        fixture = imported.ImportCheckTests()
        rows = fixture.posting_rows()
        rows[1]['description'] = 'Branch Ref / Transfer in BY: A New Name'
        rows[2]['description'] = 'Different Name Transfer out Branch Ref'
        for mode in ('basic', 'profile'):
            config = replace(fixture.config(), description_check_mode=mode, description_check_scope='labels_extra',
                             first_date_description='Opening Balance', last_date_description='Balance C/F',
                             deposit_text='Transfer in', withdrawal_text='Transfer out', description_extra_text='Branch Ref',
                             interest_text='Interest', tax_text='Tax')
            self.assertEqual(validate_edited_statement(config, rows, True), [])
            for index, wrong in ((1, 'Transfer out'), (2, 'Transfer in')):
                changed = [dict(row) for row in rows]
                changed[index].update(description=wrong + ' Branch Ref', category='deposit')
                errors = validate_edited_statement(config, changed, True)
                self.assertTrue(any(e['row_index'] == index and 'description' in e['fields'] for e in errors), errors)
            changed = [dict(row) for row in rows]
            changed[1]['description'] = 'Transfer in Any Name'
            self.assertTrue(any(e['row_index'] == 1 and 'description' in e['fields'] for e in validate_edited_statement(config, changed, True)))
            self.assertEqual(validate_edited_statement(replace(config, description_check_scope='labels'), changed, True), [])
            for index in (1, 2, 3, 4):
                changed = [dict(row) for row in rows]
                changed[index]['description'] = changed[index]['description'].swapcase()
                errors = validate_edited_statement(config, changed, True)
                self.assertTrue(any(e['row_index'] == index and 'description' in e['fields'] for e in errors), (mode, index, errors))

    def test_normal_check_uses_custom_interest_and_tax_text_without_extra_text(self):
        fixture = imported.ImportCheckTests()
        rows = fixture.posting_rows()
        rows[3].update(description='Quarterly Return', category='deposit')
        rows[4].update(description='Withholding', category='withdrawal')
        config = replace(fixture.config(), description_check_mode='basic', description_check_scope='labels',
                         deposit_text='Transfer in', withdrawal_text='Transfer out',
                         interest_text='Quarterly Return', tax_text='Withholding', description_extra_text='Optional reference')
        self.assertEqual(validate_edited_statement(config, rows, True), [])
        for index, wrong in ((3, 'Interest'), (4, 'Tax')):
            changed = [dict(row) for row in rows]
            changed[index].update(description=wrong, category='interest' if index == 3 else 'tax')
            errors = validate_edited_statement(config, changed, True)
            self.assertTrue(any(e['row_index'] == index and 'description' in e['fields'] for e in errors), errors)

    def test_normal_check_ignores_wording_profile_check_enforces_it(self):
        fixture=imported.ImportCheckTests(); rows=fixture.posting_rows()
        config=replace(fixture.config(),description_check_mode='basic',deposit_text='Unexpected label')
        self.assertEqual(validate_edited_statement(config,rows,True),[])
        config=replace(config,description_check_mode='profile',deposit_name_mode='label_only',withdrawal_name_mode='label_only',
                       first_date_description='Opening Balance',last_date_description='Balance C/F',
                       deposit_text='Transfer in',withdrawal_text='Transfer out',interest_text='Interest',tax_text='Tax')
        self.assertEqual(validate_edited_statement(config,rows,True),[])
        for index in range(len(rows)):
            changed=[dict(row) for row in rows];changed[index]['description']='Incorrect text'
            errors=validate_edited_statement(config,changed,True)
            self.assertTrue(any(e['row_index']==index and 'description' in e['fields'] for e in errors),errors)

    def test_user_status_is_additive_reversible_and_revokes_sessions(self):
        with TemporaryDirectory() as temp:
            store=AuthStore(Path(temp)/'users.db')
            admin=next(u for u in store.list_users() if u['role']=='admin')
            user=store.create_user('workspace-user','temporary-password','user','unlimited',full_name='Before',mobile_number='000000')
            store.save_profile_format(user,'Retained',{'deposit_text':'Saved label','deposit_connector_text':'By:'})
            token=store.login(user.username,'temporary-password')['token']
            updated=store.update_user_details(user.id,admin['id'],{'is_hidden':True,'full_name':'After'})
            self.assertTrue(updated.is_hidden)
            self.assertEqual(store.require_user(token).full_name,'After')
            store.update_user_details(user.id,admin['id'],{'is_blocked':True})
            with self.assertRaises(PermissionError):store.require_user(token)
            with self.assertRaises(PermissionError):store.login(user.username,'temporary-password')
            store=AuthStore(Path(temp)/'users.db')
            self.assertTrue(next(u for u in store.list_users() if u['id']==user.id)['is_blocked'])
            store.update_user_details(user.id,admin['id'],{'is_blocked':False,'is_hidden':False})
            restored=store.login(user.username,'temporary-password')['user']
            self.assertEqual(store.load_profile_format(restored,'Retained')['profile']['deposit_connector_text'],'By:')
            with self.assertRaises(PermissionError):store.update_user_details(user.id,user.id,{'full_name':'Unauthorized'})
            with self.assertRaises(PermissionError):store.update_user_details(admin['id'],admin['id'],{'is_blocked':True})
            with self.assertRaises(ValueError):store.update_user_details(user.id,admin['id'],{'is_blocked':'false'})

    def test_profile_check_loads_owned_saved_rules_without_overwriting_imported_balances(self):
        with TemporaryDirectory() as temp:
            store=AuthStore(Path(temp)/'users.db')
            user=store.create_user('checker','temporary-password','user','unlimited',full_name='Checker',mobile_number='000000')
            store.save_profile_format(user,'Existing',{'deposit_text':'Saved deposit','description_extra_text':'Saved reference','first_date_description':'Carry in','opening_balance':'999','interest_rate':'12'})
            with patch.object(web,'AUTH_STORE',store):
                checked=web.check_form({'statement_check_mode':'profile','check_profile_name':'Existing','opening_balance':'123','interest_rate':'7','deposit_text':'Tampered'},user)
                self.assertEqual(checked['deposit_text'],'Saved deposit')
                self.assertEqual(checked['opening_balance'],'123')
                self.assertEqual(checked['interest_rate'],'7')
                self.assertEqual(checked['deposit_connector_enabled'],'legacy')
                self.assertEqual(checked['description_check_scope'],'labels')
                checked=web.check_form({'statement_check_mode':'profile','check_profile_name':'Existing','description_check_scope':'labels_extra','description_extra_text':'Tampered'},user)
                self.assertEqual(checked['description_check_scope'],'labels_extra')
                self.assertEqual(checked['description_extra_text'],'Saved reference')
                with self.assertRaises(ValueError):web.check_form({'statement_check_mode':'new','description_check_scope':'invalid'},user)
                with self.assertRaises(ValueError):web.check_form({'statement_check_mode':'new','description_check_scope':'labels_extra','description_extra_text':''},user)
                with self.assertRaises(ValueError):web.check_form({'statement_check_mode':'profile'},user)
                other=store.create_user('other','temporary-password','user','unlimited',full_name='Other',mobile_number='000000')
                with self.assertRaises(ValueError):web.check_form({'statement_check_mode':'profile','check_profile_name':'Existing'},other)

    def test_custom_interest_and_tax_labels_override_importer_customer_guess(self):
        config=replace(imported.ImportCheckTests().config(),description_check_mode='profile',interest_text='Quarterly Return',tax_text='Withholding')
        rows=imported.ImportCheckTests().posting_rows()
        rows[3].update(category='deposit',description='Quarterly Return')
        rows[4].update(category='withdrawal',description='Withholding')
        classified=_imported_check_rows(config,rows)
        self.assertEqual([row['category'] for row in classified][3:5],['interest','tax'])

    def test_imported_export_preserves_posting_day_exceptions_and_summary(self):
        from .exporters import build_payload, resolve_exchange_rate
        fixture = imported.ImportCheckTests()
        config = replace(fixture.config(), description_check_mode='basic', interest_text='Quarterly Return', tax_text='Withholding')
        rows = fixture.posting_rows()
        rows[1]['category'] = 'deposit'
        rows[2]['category'] = 'withdrawal'
        rows[3].update(category='deposit', description='Quarterly Return')
        rows[4].update(category='withdrawal', description='Withholding')
        result = web.hydrate_result_payload(config, {'rows': rows, 'generated_seed': None}, True)
        self.assertEqual(result.summary.deposit_count, 1)
        self.assertEqual(result.summary.withdrawal_count, 1)
        self.assertEqual(result.summary.total_interest, 9300)
        rate = resolve_exchange_rate(result.issue_date, 'manual', 140, 'sell')
        self.assertTrue(build_payload(config, result, rate, True))
        with self.assertRaises(ValueError): web.hydrate_result_payload(config, {'rows': rows})
        with self.assertRaises(ValueError): build_payload(config, result, rate)
