"""User-owned A4 letterhead settings, scoped to a document format."""
import base64
import hashlib
import json
from pathlib import Path
import re
from uuid import uuid4


def letterhead_path(root: Path, user_id: int, kind: str, name: str) -> Path:
    if kind not in {'statement', 'certificate'} or not name.strip() or len(name) > 250:
        raise ValueError('Select a document type and format for the letterhead.')
    digest = hashlib.sha256(f'{kind}:{name}'.encode()).hexdigest()
    return root / str(int(user_id)) / (digest + '.json')


def load_letterhead(root: Path, user_id: int, kind: str, name: str) -> dict:
    path = letterhead_path(root,user_id,kind,name)
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def save_letterhead(root: Path, user_id: int, kind: str, name: str, data: dict) -> dict:
    path = letterhead_path(root,user_id,kind,name)
    if data.get('remove'):
        path.unlink(missing_ok=True)
        return {}
    image = str(data.get('image') or '')
    if not image:
        image = load_letterhead(root,user_id,kind,name).get('image','')
    match = re.fullmatch(r'data:image/(png|jpeg);base64,([A-Za-z0-9+/=\r\n]+)',image)
    if not match or len(image)>8_000_000:
        raise ValueError('Upload a PNG or JPEG letterhead up to 6 MB.')
    raw=base64.b64decode(match.group(2),validate=True)
    if not ((match.group(1)=='png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or (match.group(1)=='jpeg' and raw.startswith(b'\xff\xd8\xff'))):
        raise ValueError('The letterhead is not a valid PNG or JPEG image.')
    margins={}
    for key,default in [('top',35),('right',12),('bottom',20),('left',12)]:
        value=float(data.get(key,default))
        if not 0<=value<=90: raise ValueError('Letterhead margins must be between 0 and 90 mm.')
        margins[key]=value
    if margins['left']+margins['right']>=180 or margins['top']+margins['bottom']>=240:
        raise ValueError('Leave enough A4 space for the document content.')
    result={'image':image,'kind':kind,'name':name,**margins}
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix('.' + uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(result),encoding='utf-8')
    temporary.replace(path)
    return result
