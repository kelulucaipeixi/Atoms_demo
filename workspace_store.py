"""Private, browser-owned source snapshots outside the served static directory."""
import base64
import binascii
import json
import os
import re
import secrets
import shutil
import tempfile
from http.cookies import SimpleCookie
from pathlib import Path
from threading import Lock

ROOT = Path(os.environ.get('STUDIO_DATA_DIR') or os.environ.get('RAILWAY_VOLUME_MOUNT_PATH') or
            Path(__file__).resolve().parent / 'data').resolve()
BASE_PATH = os.environ.get('STUDIO_BASE_PATH', '').rstrip('/')
if BASE_PATH and not re.fullmatch(r'(?:/[a-zA-Z0-9_-]+)+', BASE_PATH):
    raise ValueError('STUDIO_BASE_PATH must be a URL path such as /atoms')
OWNER = re.compile(r'[0-9a-f]{64}')
PROJECT = re.compile(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|starter-board')
RUN = re.compile(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}')
SEGMENT = re.compile(r'[A-Za-z0-9_.-]{1,64}')
IMAGES = {'.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp'}
SUFFIXES = {'.html', '.css', '.js', '.json', '.md', '.txt', '.svg'} | set(IMAGES)
LOCK = Lock()
COOKIE = 'studio_workspace'


def owner_path(cookie_header):
    cookie = SimpleCookie()
    cookie.load(cookie_header)
    token = cookie[COOKIE].value if COOKIE in cookie else ''
    if OWNER.fullmatch(token):
        path = ROOT / 'workspaces' / token
        if path.is_dir():
            return path
    return None


def create_owner():
    token = secrets.token_hex(32)
    path = ROOT / 'workspaces' / token
    path.mkdir(parents=True, mode=0o700)
    cookie = f'{COOKIE}={token}; Path={BASE_PATH}/; Max-Age=31536000; HttpOnly; SameSite=Strict'
    if os.environ.get('STUDIO_SECURE_COOKIE') == '1':
        cookie += '; Secure'
    return path, cookie


def snapshot_path(owner, project_id, kind, run_id):
    if (not PROJECT.fullmatch(project_id) or kind not in {'drafts', 'versions'}
            or not RUN.fullmatch(run_id)):
        raise ValueError('无效的工作区路径。')
    return owner / 'projects' / project_id / kind / run_id


def is_image(name):
    return Path(name).suffix.lower() in IMAGES


def image_prefix(name):
    return 'data:image/' + IMAGES[Path(name).suffix.lower()] + ';base64,'


def decode_image(name, source):
    prefix = image_prefix(name)
    if not source.startswith(prefix):
        raise ValueError('图片格式不匹配。')
    try:
        image = base64.b64decode(source[len(prefix):], validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError('图片内容无效。') from error
    valid = (image.startswith(b'\xff\xd8') if prefix.startswith('data:image/jpeg') else
             image.startswith(b'\x89PNG\r\n\x1a\n') if prefix.startswith('data:image/png') else
             image.startswith(b'RIFF') and image[8:12] == b'WEBP')
    if not valid:
        raise ValueError('图片内容无效。')
    return image


def read_source(file, name):
    data = file.read_bytes()
    return image_prefix(name) + base64.b64encode(data).decode('ascii') if is_image(name) else data.decode('utf-8')


def valid_files(files):
    if not isinstance(files, dict) or not 0 < len(files) <= 48:
        raise ValueError('文件清单无效。')
    names = set(files)
    for name, source in files.items():
        parts = name.split('/')
        if (len(name) > 180 or len(parts) > 6
                or any(not SEGMENT.fullmatch(part) or part in {'.', '..'} for part in parts)
                or Path(parts[-1]).suffix.lower() not in SUFFIXES
                or not isinstance(source, str) or len(source.encode()) > (150000 if is_image(name) else 80000)
                or any('/'.join(parts[:i]) in names for i in range(1, len(parts)))):
            raise ValueError('文件路径或内容无效。')


def read_snapshot(folder):
    with LOCK:
        revision = (folder / 'current').read_text(encoding='ascii')
        source = folder / revision
        names = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
        return {name: read_source(source / 'files' / name, name) for name in names}


def write_snapshot(folder, files):
    valid_files(files)
    with LOCK:
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        target = Path(tempfile.mkdtemp(prefix='snapshot-', dir=folder))
        pointer = folder / '.current.new'
        try:
            for name, source in files.items():
                file = target / 'files' / name
                file.parent.mkdir(parents=True, exist_ok=True)
                if is_image(name):
                    file.write_bytes(decode_image(name, source))
                else:
                    file.write_text(source, encoding='utf-8')
            (target / 'manifest.json').write_text(json.dumps(list(files)), encoding='utf-8')
            pointer.write_text(target.name, encoding='ascii')
            pointer.replace(folder / 'current')
        except (OSError, ValueError, UnicodeError):
            shutil.rmtree(target, ignore_errors=True)
            raise
        for old in folder.glob('snapshot-*'):
            if old != target:
                shutil.rmtree(old, ignore_errors=True)
