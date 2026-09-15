"""Office format conversion; source files are always left intact."""

import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory


def convert_office(source: Path, destination: Path) -> None:
    source, destination = source.resolve(), destination.resolve()
    if source == destination:
        raise ValueError('Conversion needs a separate output file.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    suffix = destination.suffix.lstrip('.').lower()
    if os.name == 'nt':
        command = ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                   '-File', str(Path(__file__).with_name('office_convert.ps1')),
                   '-InputPath', str(source), '-OutputPath', str(destination), '-Format', suffix]
        process = subprocess.run(command, capture_output=True, text=True, timeout=90,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if process.returncode or not destination.is_file():
            raise ValueError('Office could not convert this file. Check that Excel/Word is installed and the file is not password protected. ' + process.stderr[-1200:])
        return
    executable = os.environ.get('SGV2_LIBREOFFICE') or shutil.which('soffice') or shutil.which('libreoffice')
    if not executable:
        raise ValueError('Reading legacy .xls/.doc formats requires Microsoft Office on Windows or LibreOffice on this server. Save as .xlsx/.docx or configure the conversion engine.')
    with TemporaryDirectory(prefix='sg-office-') as temporary:
        root = Path(temporary)
        profile = (root / 'profile').as_uri()
        process = subprocess.run([executable, f'-env:UserInstallation={profile}', '--headless',
                                  '--convert-to', suffix, '--outdir', str(root), str(source)],
                                 capture_output=True, text=True, timeout=90)
        converted = root / f'{source.stem}.{suffix}'
        if process.returncode or not converted.exists():
            raise ValueError('LibreOffice could not convert this file. It may be damaged or password protected.')
        shutil.copy2(converted, destination)


def editable_office_copy(source: Path) -> Path:
    """Cache an OOXML editing copy next to a legacy source without overwriting it."""
    if source.suffix.lower() not in {'.xls', '.doc'}:
        return source
    folder = source.parent / '.editable'
    target = folder / (source.stem + ('.xlsx' if source.suffix.lower() == '.xls' else '.docx'))
    if not target.exists() or target.stat().st_mtime < source.stat().st_mtime:
        convert_office(source, target)
    return target
