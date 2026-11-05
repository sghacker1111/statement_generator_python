"""Native normal Word statements and common document page settings."""
from pathlib import Path
import re


def clean_office_text(value: str) -> str:
    value=re.sub(r'(?:Ã[‚\x82])*Â(?=\xa0|&nbsp;|&#160;|\s)', '', value)
    return value.replace('\xa0',' ')


def repair_native_text(path: Path) -> None:
    if path.suffix.lower()=='.xlsx':
        from openpyxl import load_workbook
        book=load_workbook(path,rich_text=True);changed=False
        for sheet in book:
            for row in sheet:
                for cell in row:
                    if isinstance(cell.value,str) and not cell.value.startswith('='):
                        value=clean_office_text(cell.value)
                        if value!=cell.value:cell.value=value;changed=True
        if changed:book.save(path)
        book.close()
    elif path.suffix.lower()=='.docx':
        from docx import Document
        doc=Document(path);changed=False
        paragraphs=list(doc.paragraphs)
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:paragraphs.extend(cell.paragraphs)
        for section in doc.sections:
            paragraphs.extend(section.header.paragraphs);paragraphs.extend(section.footer.paragraphs)
        for paragraph in paragraphs:
            for run in paragraph.runs:
                text=clean_office_text(run.text)
                if text!=run.text:run.text=text;changed=True
        if changed:doc.save(path)


def native_statement_word(path: Path, payload: dict) -> None:
    from docx import Document
    from docx.shared import Mm, Pt
    from .sample_documents import mark_document
    document=Document();section=document.sections[0]
    section.page_width=Mm(210);section.page_height=Mm(297)
    section.left_margin=section.right_margin=Mm(12)
    section.top_margin=section.bottom_margin=Mm(16)
    document.styles['Normal'].font.name='Calibri';document.styles['Normal'].font.size=Pt(10)
    document.add_heading('Statement of Account',1)
    document.add_paragraph(str(payload.get('account',{}).get('customer_name','')))
    include=payload.get('statement',{}).get('include_cheque_column',True)
    double=payload.get('statement',{}).get('date_column_mode')=='txn_value'
    headers=(['TXN Date','Value Date'] if double else ['Date'])+['Description']+(['Cheque No.'] if include else [])+['Debit','Credit','Balance']
    table=document.add_table(rows=1,cols=len(headers));table.style='Table Grid'
    for cell,text in zip(table.rows[0].cells,headers):cell.text=text
    for row in payload['statement_rows']:
        dates=[row.get('txn_date') or row['date'],row.get('value_date') or row['date']] if double else [row['date']]
        values=dates+[row['description']]+([str(row.get('cheque_no',''))] if include else [])+[row.get('debit_text',''),row.get('credit_text',''),row.get('balance_text','')]
        for cell,text in zip(table.add_row().cells,values):cell.text=str(text)
    mark_document(document);document.save(path)


def page_settings(path: Path, kind: str) -> dict:
    if kind=='statement':
        from openpyxl import load_workbook
        from .statement_template import scan_statement_layout
        book=load_workbook(path,rich_text=True)
        layout=scan_statement_layout(book)
        sheet=book[layout["sheet"]] if layout else book.active
        result={side:round(getattr(sheet.page_margins,side)*25.4,2) for side in ['top','right','bottom','left']}
        result['orientation']=sheet.page_setup.orientation or 'portrait';book.close();return result
    from docx import Document
    section=Document(path).sections[0]
    return {**{side:round(getattr(section,side+'_margin').mm,2) for side in ['top','right','bottom','left']},'orientation':'landscape' if section.page_width>section.page_height else 'portrait'}


def update_page_settings(path: Path, kind: str, settings: dict) -> None:
    values={side:max(0,min(90,float(settings.get(side,12)))) for side in ['top','right','bottom','left']}
    landscape=settings.get('orientation')=='landscape'
    if kind=='statement':
        from openpyxl import load_workbook
        from .statement_template import scan_statement_layout
        book=load_workbook(path,rich_text=True)
        layout=scan_statement_layout(book)
        sheet=book[layout["sheet"]] if layout else book.active
        for side,value in values.items():setattr(sheet.page_margins,side,value/25.4)
        sheet.page_setup.orientation='landscape' if landscape else 'portrait';book.save(path);book.close();return
    from docx import Document
    from docx.shared import Mm
    document=Document(path)
    for section in document.sections:
        for side,value in values.items():setattr(section,side+'_margin',Mm(value))
        section.page_width=Mm(297 if landscape else 210);section.page_height=Mm(210 if landscape else 297)
    document.save(path)
