"""Embed an owned A4 letterhead in exported Office packages without flattening cells/text."""
import base64
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
try:
    from lxml import etree as ET
except ImportError:  # Only this optional export feature needs lxml.
    ET = None
from zipfile import ZipFile, ZIP_DEFLATED

NS = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      's':'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'p':'http://schemas.openxmlformats.org/package/2006/relationships',
      'ct':'http://schemas.openxmlformats.org/package/2006/content-types',
      'v':'urn:schemas-microsoft-com:vml','o':'urn:schemas-microsoft-com:office:office'}
if ET is not None:
    for prefix, uri in NS.items(): ET.register_namespace(prefix,uri)


def embed_letterhead(path: Path, settings: dict) -> None:
    if ET is None: raise RuntimeError('Letterhead export requires lxml (included with python-docx).')
    if not settings.get('image'): raise ValueError('Save a letterhead for this format before exporting with letterhead.')
    mime, encoded = settings['image'].split(';base64,',1)
    suffix='png' if mime=='data:image/png' else 'jpeg'
    raw=base64.b64decode(encoded,validate=True)
    with ZipFile(path) as archive: files={name:archive.read(name) for name in archive.namelist()}
    def read(name, tag):return ET.fromstring(files[name]) if name in files else ET.Element(tag)
    def write(name, element):files[name]=ET.tostring(element,encoding='utf-8',xml_declaration=True)
    def relation(part, kind, target):
        relpath=str(PurePosixPath(part).parent/'_rels'/(PurePosixPath(part).name+'.rels'))
        root=read(relpath,f'{{{NS["p"]}}}Relationships')
        used={el.get('Id') for el in root};index=1
        while f'rIdLetterhead{index}' in used:index+=1
        rid=f'rIdLetterhead{index}'
        ET.SubElement(root,f'{{{NS["p"]}}}Relationship',Id=rid,Type=NS['r']+'/'+kind,Target=target)
        write(relpath,root);return rid
    types=read('[Content_Types].xml',f'{{{NS["ct"]}}}Types')
    def content_type(extension, mime_type):
        if not any(el.get('Extension')==extension for el in types):ET.SubElement(types,f'{{{NS["ct"]}}}Default',Extension=extension,ContentType=mime_type)
    content_type(suffix,'image/'+suffix)
    def image_shape(parent, rid, *, word):
        if not word:
            layout=ET.SubElement(parent,f'{{{NS["o"]}}}shapelayout',{f'{{{NS["v"]}}}ext':'edit'})
            ET.SubElement(layout,f'{{{NS["o"]}}}idmap',{f'{{{NS["v"]}}}ext':'edit','data':'1'})
        shape_type=ET.SubElement(parent,f'{{{NS["v"]}}}shapetype',id='_x0000_t75',coordsize='21600,21600',path='m@4@5l@4@11@9@11@9@5xe',filled='f',stroked='f')
        shape_type.set(f'{{{NS["o"]}}}spt','75')
        shape_type.set(f'{{{NS["o"]}}}preferrelative','t')
        ET.SubElement(shape_type,f'{{{NS["v"]}}}stroke',joinstyle='miter')
        formulas=ET.SubElement(shape_type,f'{{{NS["v"]}}}formulas')
        for equation in ['if lineDrawn pixelLineWidth 0','sum @0 1 0','sum 0 0 @1','prod @2 1 2','prod @3 21600 pixelWidth','prod @3 21600 pixelHeight','sum @0 0 1','prod @6 1 2','prod @7 21600 pixelWidth','sum @8 21600 0','prod @7 21600 pixelHeight','sum @10 21600 0']:
            ET.SubElement(formulas,f'{{{NS["v"]}}}f',eqn=equation)
        ET.SubElement(shape_type,f'{{{NS["v"]}}}path',{f'{{{NS["o"]}}}extrusionok':'f','gradientshapeok':'t',f'{{{NS["o"]}}}connecttype':'rect'})
        ET.SubElement(shape_type,f'{{{NS["o"]}}}lock',{f'{{{NS["v"]}}}ext':'edit','aspectratio':'t'})
        shape=ET.SubElement(parent,f'{{{NS["v"]}}}shape',id='StatementLetterhead' if word else 'CH',type='#_x0000_t75')
        shape.set(f'{{{NS["o"]}}}spid','_x0000_s1025')
        shape.set('style',('position:absolute;margin-left:0;margin-top:0;z-index:-251654144;mso-position-horizontal-relative:page;mso-position-vertical-relative:page;' if word else 'position:absolute;margin-left:0;margin-top:0;z-index:1;')+'width:595.2756pt;height:841.8898pt')
        ET.SubElement(shape,f'{{{NS["v"]}}}imagedata',{f'{{{NS["r"]}}}id':rid} if word else {f'{{{NS["o"]}}}relid':rid})
        ET.SubElement(shape,f'{{{NS["o"]}}}lock',{f'{{{NS["v"]}}}ext':'edit','rotation':'t'})
        return shape
    if path.suffix.lower()=='.docx':
        w=lambda tag:f'{{{NS["w"]}}}{tag}'
        document=read('word/document.xml',w('document'))
        files[f'word/media/statement-letterhead.{suffix}']=raw
        document_rels=read('word/_rels/document.xml.rels',f'{{{NS["p"]}}}Relationships')
        targets={el.get('Id'):el.get('Target') for el in document_rels}
        headers={};counter=0
        for section in document.iter(w('sectPr')):
            size=section.find(w('pgSz'))
            if size is None:size=ET.SubElement(section,w('pgSz'))
            size.attrib.update({w('w'):'11906',w('h'):'16838'});size.attrib.pop(w('orient'),None)
            margins=section.find(w('pgMar'))
            if margins is None:margins=ET.SubElement(section,w('pgMar'))
            for key,default in [('top',35),('bottom',20),('left',12),('right',12)]:margins.set(w(key),str(round(float(settings.get(key,default))*1440/25.4)))
            margins.set(w('header'),'0')
            refs=list(section.findall(w('headerReference')))
            for kind in ['default','first','even']:
                if not any(el.get(w('type'))==kind for el in refs):
                    counter+=1;name=f'headerLetterhead{counter}.xml'
                    while 'word/'+name in files:counter+=1;name=f'headerLetterhead{counter}.xml'
                    rid=relation('word/document.xml','header',name);targets[rid]=name
                    ref=ET.Element(w('headerReference'),{w('type'):kind,f'{{{NS["r"]}}}id':rid});section.insert(0,ref);refs.append(ref)
                    files['word/'+name]=ET.tostring(ET.Element(w('hdr')))
                    ET.SubElement(types,f'{{{NS["ct"]}}}Override',PartName='/word/'+name,ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml')
            for ref in refs:
                target=targets.get(ref.get(f'{{{NS["r"]}}}id'))
                if target:headers['word/'+target.lstrip('/') if not target.startswith('/') else target.lstrip('/')]=True
        for header in headers:
            root=read(header,w('hdr'));paragraph=ET.Element(w('p'));run=ET.SubElement(paragraph,w('r'));picture=ET.SubElement(run,w('pict'))
            rid=relation(header,'image',f'media/statement-letterhead.{suffix}')
            image_shape(picture,rid,word=True);root.insert(0,paragraph);write(header,root)
        write('word/document.xml',document)
    elif path.suffix.lower()=='.xlsx':
        s=lambda tag:f'{{{NS["s"]}}}{tag}'
        files[f'xl/media/statement-letterhead.{suffix}']=raw;content_type('vml','application/vnd.openxmlformats-officedocument.vmlDrawing')
        for index, name in enumerate([n for n in files if n.startswith('xl/worksheets/') and n.endswith('.xml') and '/_rels/' not in n]):
            sheet=read(name,s('worksheet'))
            def child(tag,before):
                el=sheet.find(s(tag))
                if el is None:
                    el=ET.Element(s(tag));pos=next((i for i,c in enumerate(sheet) if c.tag.rsplit('}',1)[-1] in before),len(sheet));sheet.insert(pos,el)
                return el
            margins=child('pageMargins',{'pageSetup','headerFooter','rowBreaks','colBreaks','drawing','legacyDrawing','legacyDrawingHF','picture','extLst'})
            for key,default in [('top',35),('bottom',20),('left',12),('right',12)]:margins.set(key,str(float(settings.get(key,default))/25.4))
            margins.set('header','0');margins.set('footer','0')
            setup=child('pageSetup',{'headerFooter','rowBreaks','colBreaks','drawing','legacyDrawing','legacyDrawingHF','picture','extLst'});setup.attrib.update({'paperSize':'9','orientation':'portrait','fitToWidth':'1','fitToHeight':'0'})
            header=child('headerFooter',{'rowBreaks','colBreaks','drawing','legacyDrawing','legacyDrawingHF','picture','extLst'});header.attrib.update({'differentFirst':'0','differentOddEven':'0','scaleWithDoc':'0','alignWithMargins':'0'})
            odd=header.find(s('oddHeader'))
            if odd is None:odd=ET.Element(s('oddHeader'));header.insert(0,odd)
            odd.text='&C&G'
            drawing=f'xl/drawings/letterhead{index+1}.vml'
            shape_root=ET.Element('xml');rid=relation(drawing,'image',f'../media/statement-letterhead.{suffix}');image_shape(shape_root,rid,word=False);write(drawing,shape_root)
            legacy=child('legacyDrawingHF',{'picture','oleObjects','controls','webPublishItems','tableParts','extLst'});legacy.set(f'{{{NS["r"]}}}id',relation(name,'vmlDrawing',f'../drawings/letterhead{index+1}.vml'))
            write(name,sheet)
    else:raise ValueError('Letterhead export requires .xlsx or .docx output.')
    write('[Content_Types].xml',types)
    with TemporaryDirectory(prefix='statement-letterhead-') as temp:
        output=Path(temp)/path.name
        with ZipFile(output,'w',ZIP_DEFLATED) as archive:
            for name,data in files.items():archive.writestr(name,data)
        path.write_bytes(output.read_bytes())
