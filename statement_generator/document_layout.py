"""Render Word content in document order while retaining local formatting."""

import base64
from html import escape
from pathlib import Path


def word_html(path: Path, title='Balance Certificate', editable_keys=False) -> str:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    from docx.oxml.ns import qn

    document = Document(path)

    def inherited(obj, name, fallback=None):
        value = getattr(obj, name, None)
        if value is not None:
            return value
        return fallback

    def attr(node, name, default=''):
        return node.get(qn('w:' + name), default) if node is not None else default

    def styles(paragraph):
        chain = [paragraph.paragraph_format]
        current = paragraph.style
        visited = set()
        while current is not None and current.style_id not in visited:
            visited.add(current.style_id)
            chain.append(current.paragraph_format)
            current = current.base_style
        def value(name):
            return next((getattr(item, name) for item in chain if getattr(item, name) is not None), None)
        result = {'white-space':'pre-wrap', 'margin':'0', 'min-height':'1em'}
        alignment = value('alignment')
        if alignment is not None:
            result['text-align'] = {0:'left',1:'center',2:'right',3:'justify'}.get(int(alignment), 'left')
        for name, css in [('left_indent','margin-left'),('right_indent','margin-right'),
                          ('first_line_indent','text-indent'),('space_before','margin-top'),('space_after','margin-bottom')]:
            length = value(name)
            if length is not None: result[css] = f'{length.pt:g}pt'
        spacing = value('line_spacing')
        if spacing is not None: result['line-height'] = f'{spacing.pt:g}pt' if hasattr(spacing,'pt') else str(spacing)
        if value('page_break_before'): result['break-before']='page'
        if value('keep_with_next'): result['break-after']='avoid'
        if value('keep_together'): result['break-inside']='avoid'
        return result

    def css(values):
        return escape(';'.join(f'{k}:{v}' for k,v in values.items()), quote=True)

    def paragraph_html(paragraph, key=''):
        pieces=[]
        from docx.text.run import Run
        for element in paragraph._p.xpath('./*[local-name()="r"] | ./*[local-name()="hyperlink"]/*[local-name()="r"]'):
            run = Run(element, paragraph)
            font_chain=[run.font]
            if run.style is not None: font_chain.append(run.style.font)
            style=paragraph.style
            visited=set()
            while style is not None and style.style_id not in visited:
                visited.add(style.style_id);font_chain.append(style.font);style=style.base_style
            def font_value(name):
                return next((getattr(f,name) for f in font_chain if getattr(f,name,None) is not None), None)
            fmt={}
            if font_value('name'): fmt['font-family']=str(font_value('name')).replace(';','')
            if font_value('size'): fmt['font-size']=f'{font_value("size").pt:g}pt'
            if font_value('bold'): fmt['font-weight']='bold'
            if font_value('italic'): fmt['font-style']='italic'
            if font_value('underline'): fmt['text-decoration']='underline'
            if font_value('strike'): fmt['text-decoration']=fmt.get('text-decoration','')+' line-through'
            if font_value('hidden'): fmt['display']='none'
            if run.font.color.rgb: fmt['color']='#'+str(run.font.color.rgb)
            if font_value('superscript'): fmt['vertical-align']='super'
            if font_value('subscript'): fmt['vertical-align']='sub'
            text=escape(run.text).replace('\t','<span style="display:inline-block;min-width:36pt;white-space:pre">\t</span>').replace('\n','<br>')
            pieces.append(f'<span style="{css(fmt)}">{text}</span>')
            for blip in run._element.xpath('.//*[local-name()="blip"]'):
                relationship=blip.get(qn('r:embed'))
                part=paragraph.part.related_parts.get(relationship)
                if part is not None and part.content_type.startswith('image/'):
                    data=base64.b64encode(part.blob).decode()
                    extent=run._element.xpath('.//*[local-name()="extent"]')
                    size=''
                    if extent: size=f'width:{int(extent[0].get("cx",0))/12700:g}pt;height:{int(extent[0].get("cy",0))/12700:g}pt;'
                    pieces.append(f'<img alt="" style="{size}max-width:100%" src="data:{part.content_type};base64,{data}">')
        # Preserve hyperlinks which are not exposed in paragraph.runs by older python-docx.
        if not pieces and paragraph.text: pieces.append(escape(paragraph.text))
        key_attr=f' data-template-key="{escape(key,quote=True)}"' if editable_keys and key else ''
        return f'<p{key_attr} style="{css(styles(paragraph))}">{"".join(pieces) or "<br>"}</p>'

    def table_html(table, index):
        result=['<table style="border-collapse:collapse;table-layout:fixed;margin:0;width:auto"><colgroup>']
        for column in table.columns:
            width=f'{column.width.pt:g}pt' if column.width else 'auto'
            result.append(f'<col style="width:{width}">')
        result.append('</colgroup>')
        consumed=set()
        for r,row in enumerate(table.rows):
            result.append('<tr>')
            for c,cell in enumerate(row.cells):
                identity=cell._tc
                if identity in consumed: continue
                consumed.add(identity)
                colspan=sum(1 for candidate in row.cells[c:] if candidate._tc is identity)
                rowspan=1
                for later in table.rows[r+1:]:
                    if c<len(later.cells) and later.cells[c]._tc is identity: rowspan+=1
                    else: break
                fmt={'vertical-align':{0:'top',1:'middle',3:'bottom'}.get(int(cell.vertical_alignment or 0),'top'), 'padding':'0 5.4pt'}
                if cell.width: fmt['width']=f'{cell.width.pt:g}pt'
                props=cell._tc.tcPr
                if props is not None:
                    shade=props.find(qn('w:shd'))
                    fill=attr(shade,'fill')
                    if fill and fill not in {'auto','none'}: fmt['background-color']='#'+fill
                    borders=props.find(qn('w:tcBorders'))
                    if borders is not None:
                        for side in ['top','bottom','left','right']:
                            border=borders.find(qn('w:'+side))
                            if border is not None:
                                fmt['border-'+side]='none' if attr(border,'val') in {'nil','none'} else f'{float(attr(border,"sz","4"))/8:g}pt solid #{attr(border,"color","000000").replace("auto","000000")}'
                    margins=props.find(qn('w:tcMar'))
                    if margins is not None:
                        for side in ['top','bottom','left','right']:
                            margin=margins.find(qn('w:'+side))
                            if margin is not None:fmt['padding-'+side]=f'{float(attr(margin,"w","0"))/20:g}pt'
                key=f' data-template-key="t:{index}:r:{r}:c:{c}"' if editable_keys else ''
                result.append(f'<td{key} colspan="{colspan}" rowspan="{rowspan}" style="{css(fmt)}">')
                result.extend(paragraph_html(p) for p in cell.paragraphs)
                result.append('</td>')
            result.append('</tr>')
        result.append('</table>')
        return ''.join(result)

    parts=[]
    paragraph_index=table_index=0
    section=document.sections[0]
    for paragraph in section.header.paragraphs:
        if paragraph.text or paragraph._p.xpath('.//*[local-name()="drawing"]'): parts.append(paragraph_html(paragraph))
    for node in document.element.body:
        if node.tag==qn('w:p'):
            parts.append(paragraph_html(Paragraph(node,document),f'p:{paragraph_index}'));paragraph_index+=1
        elif node.tag==qn('w:tbl'):
            parts.append(table_html(Table(node,document),table_index));table_index+=1
    for paragraph in section.footer.paragraphs:
        if paragraph.text or paragraph._p.xpath('.//*[local-name()="drawing"]'): parts.append(paragraph_html(paragraph))
    width=section.page_width.pt if section.page_width else 595.28
    margins=[(getattr(section,name).pt if getattr(section,name) is not None else 36) for name in ['top_margin','right_margin','bottom_margin','left_margin']]
    wrapper=f'<div class="office-document" style="box-sizing:border-box;width:{width:g}pt;padding:{" ".join(f"{n:g}pt" for n in margins)};color:#000;font-family:Calibri,Arial,sans-serif;font-size:11pt;background:white">'+''.join(parts)+'</div>'
    return f'<!doctype html><html><head><meta charset="utf-8"><title>{escape(title)}</title><style>@page{{size:A4;margin:0}}body{{margin:0}}.office-document{{margin:0 auto}}@media print{{.office-document{{width:100%!important}}}}</style></head><body>{wrapper}</body></html>'
