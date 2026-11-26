"""Published version snapshots, independent of private workspace folders."""
import hashlib
import json
import re
import tempfile
import time
from pathlib import Path

from workspace_store import ROOT, read_snapshot, snapshot_path, is_image


DIRECTORY = ROOT / 'discovery'
PUBLIC_ID = re.compile(r'[a-f0-9]{32}')
FIELDS = ('id', 'title', 'description', 'author', 'publishedAt', 'hasCover')


def metadata(record):
    return {key: record[key] for key in FIELDS}


def read_public(public_id):
    if not PUBLIC_ID.fullmatch(public_id):
        raise FileNotFoundError
    return json.loads((DIRECTORY / (public_id + '.json')).read_text(encoding='utf-8'))


def list_public():
    entries = sorted(DIRECTORY.glob('*.json'), key=lambda file: file.stat().st_mtime, reverse=True)
    return [metadata(read_public(file.stem)) for file in entries[:60]]


def publish(owner, body):
    project_id, version_id = body.get('projectId', ''), body.get('versionId', '')
    title, author, description, html = (body.get(key) for key in ('title', 'author', 'description', 'html'))
    if (not all(isinstance(value, str) for value in (project_id, version_id, title, author, description, html))
            or not title.strip() or len(title) > 120 or len(author) > 80 or len(description) > 220
            or not re.search(r'<html\b', html, re.I) or len(html.encode()) > 550000):
        raise ValueError('发布内容无效。')
    files = read_snapshot(snapshot_path(owner, project_id, 'versions', version_id))
    public_id = hashlib.sha256((owner.name + ':' + project_id).encode()).hexdigest()[:32]
    record = {'id': public_id, 'title': title.strip(), 'author': author.strip(), 'description': description.strip(),
              'publishedAt': int(time.time() * 1000), 'hasCover': any(is_image(name) for name in files),
              'html': html, 'files': files}
    DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(mode='w', dir=DIRECTORY, delete=False, encoding='utf-8') as temporary:
        json.dump(record, temporary, ensure_ascii=False)
    path = DIRECTORY / (public_id + '.json')
    Path(temporary.name).replace(path)
    return metadata(record)
