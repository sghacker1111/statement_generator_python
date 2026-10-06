import base64
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, skipUnless
from importlib.util import find_spec
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from .letterhead_export import embed_letterhead, NS

PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'
SETTINGS={'image':'data:image/png;base64,'+PNG,'top':35,'right':12,'bottom':20,'left':12}

@skipUnless(all(find_spec(name) for name in ('openpyxl','docx','lxml')), 'Optional Office export libraries are not installed')
class LetterheadExportTests(TestCase):
    def test_excel_preserves_cells_and_embeds_repeating_a4_header(self):
        from openpyxl import Workbook,load_workbook
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/'statement.xlsx';book=Workbook();book.active['A1']='SAMPLE';book.active['B2']='=SUM(1,2)';book.save(path)
            embed_letterhead(path,SETTINGS)
            self.assertEqual(load_workbook(path).active['B2'].value,'=SUM(1,2)')
            with ZipFile(path) as archive:
                self.assertEqual(archive.read('xl/media/statement-letterhead.png'),base64.b64decode(PNG))
                sheet=ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
                self.assertEqual(sheet.find('s:headerFooter/s:oddHeader',NS).text,'&C&G')
                self.assertEqual(sheet.find('s:pageSetup',NS).get('paperSize'),'9')
                self.assertIsNotNone(sheet.find('s:legacyDrawingHF',NS))
                ET.fromstring(archive.read('xl/drawings/letterhead1.vml'))

    def test_word_preserves_existing_header_content_and_body(self):
        from docx import Document
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/'certificate.docx';doc=Document();doc.add_paragraph('SAMPLE certificate');doc.sections[0].header.paragraphs[0].text='Existing header';doc.save(path)
            embed_letterhead(path,SETTINGS)
            output=Document(path)
            self.assertEqual(output.paragraphs[0].text,'SAMPLE certificate')
            self.assertIn('Existing header',' '.join(p.text for p in output.sections[0].header.paragraphs))
            with ZipFile(path) as archive:
                self.assertEqual(archive.read('word/media/statement-letterhead.png'),base64.b64decode(PNG))
                document=ET.fromstring(archive.read('word/document.xml'))
                section=document.find('.//w:sectPr',NS)
                self.assertEqual(len(section.findall('w:headerReference',NS)),3)
                self.assertEqual(section.find('w:pgSz',NS).get('{'+NS['w']+'}w'),'11906')

    def test_missing_letterhead_does_not_modify_original(self):
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/'keep.xlsx';path.write_bytes(b'original')
            with self.assertRaises(ValueError):embed_letterhead(path,{})
            self.assertEqual(path.read_bytes(),b'original')
