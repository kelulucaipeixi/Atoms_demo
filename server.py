"""Serve the Studio and an optional OpenAI-compatible generation endpoint."""
import json
import os
import re
import threading
import subprocess
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http.client import HTTPException
from io import BytesIO
from pathlib import Path
from http.cookies import CookieError
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen, getproxies

from workspace_store import BASE_PATH, owner_path, read_snapshot, snapshot_path, write_snapshot, decode_image, is_image
from discovery_store import list_public, publish, read_public
import auth_store as auth

STATIC = Path(__file__).resolve().parent / 'dist'
PUBLIC_ORIGIN = os.environ.get('STUDIO_PUBLIC_ORIGIN')
CAPACITY = threading.BoundedSemaphore(2)
DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash'
SYSTEM = {
    'plan': (
        'Plan a standalone Chinese web application. Output JSON with title, summary, and '
        'one to five concrete features as strings. Example: '
        '{"title":"预约页","summary":"用表单提交预约","features":["填写姓名","显示确认信息"]}. '
        'Describe the requested user-facing behavior. '
        'Preserve unrelated features from the current workspace.'
    ),
    'review': (
        'Diagnose the failed browser acceptance using the original user request, task brief, '
        'current workspace source, and observed controls. Return only JSON '
        '{"decision":"retarget","candidateId":1,"reason":"why this is the same control"} or '
        '{"decision":"repair","candidateId":null,"reason":"root cause and the smallest source fix"}. '
        'Retarget only an enabled, unique candidate in the browser evidence that performs the '
        'same requested action. Never change the input value, action, requirement, or expected '
        'result to pass the check. If no candidate reliably matches, choose repair.'
    ),
    'code': (
        'Implement the brief in the supplied workspace. Return only JSON '
        '{"files":{"index.html":"complete HTML","styles/site.css":"CSS","src/app.js":"browser JavaScript"}}. '
        'The file tool writes complete files. In iterations return only changed files. '
        'Link styles and classic scripts with project-relative paths in index.html. '
        'Use accessible labels, semantic sections, responsive CSS, and native forms and tables. '
        'For habit grids use real habit row and weekday column headers and native checkboxes '
        'or buttons with aria-pressed. No external assets, network, frameworks or npm dependencies. '
        'The preview is a sandboxed iframe. Guard browser storage access so unavailable storage '
        'does not prevent the page and its controls from working. '
        'Keep output concise.'
    ),
    'repair': (
        'Read the supplied workspace and build diagnostic. Return only JSON '
        '{"files":{"supported filename":"complete updated contents"}}. '
        'Preserve existing project-relative paths. Nested source directories are supported. Return only changed files. '
        'Make the smallest change that resolves the diagnostic. Preserve behavior outside '
        'the failure and keep the original requirements. Do not require extra form fields or steps. '
        'An alternative label or ID for the same feature is acceptable. Resolve behavior, '
        'avoid hard-coding test values or success messages, and keep the original acceptance result. '
        'Guard browser storage access in the sandboxed preview. '
        'No external dependencies.'
    ),
}

ACCEPTANCE_PLAN = (
    ' Include a check that covers one core user flow, e.g. "check":{"label":"提交预约",'
    '"actions":[{"type":"fill","label":"姓名","value":"小林"},{"type":"click","label":"确认预约"}],'
    '"expect":{"type":"text","value":"预约已确认"}}. Use at most six actions. Choose click, fill, '
    'or select; use accessible labels, optional scope for duplicate names, and row and column '
    'for grid controls. Expect one observable outcome: text that appears, an anchor hash, '
    'or a changed pressed state on the final clicked button or checkbox (value true or false). '
    'Use a specific result from the requirement or brief. Avoid invented DOM IDs and unneeded scope. '
    'Return "check":null only for an informational page with no core interactions.'
)


LOCAL_AGENT = os.environ.get('STUDIO_LOCAL_AGENT') == '1'

def planning_response(content, prompt, include_check=False):
    """Supply a task brief that both current and already-open clients can read."""
    try:
        document = json.loads(re.sub(r'^\s*```(?:json)?\s*|\s*```\s*$', '', content, flags=re.I))
    except (ValueError, TypeError):
        document = {}
    if not isinstance(document, dict):
        document = {}
    summary = document.get('summary')
    summary = summary.strip()[:400] if isinstance(summary, str) and summary.strip() else prompt[:400]
    title = document.get('title')
    title = title.strip()[:80] if isinstance(title, str) else ''
    features = []
    entries = document.get('features')
    for entry in entries[:12] if isinstance(entries, list) else []:
        if isinstance(entry, dict):
            entry = '：'.join(value.strip() for value in (entry.get('name'), entry.get('description'))
                             if isinstance(value, str) and value.strip())
        if isinstance(entry, str) and entry.strip():
            features.append(entry.strip()[:140])
    brief = {'title': title, 'summary': summary, 'features': features[:5] or ['按原始需求实现核心功能']}
    if include_check:
        if 'check' in document:
            brief['check'] = document['check']
    else:
        # Already-open older clients use a different check format.
        brief['check'] = None
    return json.dumps(brief, ensure_ascii=False)


def run_agent(instruction, prompt):
    """Run one isolated, read-only code-generation turn for the local reviewer."""
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / 'result.txt'
        args = ['codex', 'exec', '--ephemeral', '--ignore-user-config',
                '--skip-git-repo-check', '--sandbox', 'read-only', '-C', directory,
                '-c', 'approval_policy="never"', '-c', 'web_search="disabled"',
                '-c', 'model_reasoning_effort="low"', '-o', str(output)]
        for feature in ('shell_tool', 'unified_exec', 'apps', 'plugins',
                        'computer_use', 'multi_agent', 'in_app_browser'):
            args.extend(['--disable', feature])
        env = os.environ.copy()
        for scheme, proxy in getproxies().items():
            if scheme in ('http', 'https'):
                env.setdefault(scheme.upper() + '_PROXY', proxy)
        subprocess.run(args + ['-'], cwd=directory, env=env, input=instruction + '\n' + prompt,
                       text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=180, check=True)
        return output.read_text()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def reply(self, status, payload, cookie=None, retry_after=None):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        if retry_after:
            self.send_header('Retry-After', str(retry_after))
        try:
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def log_request(self, code='-', size='-'):
        path = self.app_path(self.path)
        if path and path.startswith('/api/auth/'):
            self.log_message('"%s %s" %s %s', self.command, path, str(code), str(size))
        else:
            super().log_request(code, size)

    def same_origin(self):
        value = self.headers.get('Origin', '')
        origin = urlsplit(value)
        return origin.scheme in ('http', 'https') and (
            origin.netloc == self.headers.get('Host') or value == PUBLIC_ORIGIN)

    def app_path(self, request_path):
        path = urlsplit(request_path).path
        if not BASE_PATH:
            return path
        if path.startswith(BASE_PATH + '/'):
            return path[len(BASE_PATH):]
        return None

    def translate_path(self, path):
        return super().translate_path(self.app_path(path) or '/')

    def send_head(self):
        url = urlsplit(self.path)
        if url.path == '/healthz' or self.app_path(self.path) == '/healthz':
            body = b'ok\n'
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return BytesIO(body)
        if BASE_PATH and url.path in ('/', BASE_PATH):
            self.send_response(308)
            self.send_header('Location', BASE_PATH + '/' + (('?' + url.query) if url.query else ''))
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        if self.app_path(self.path) is None:
            self.send_error(404)
            return None
        return super().send_head()

    def workspace_owner(self):
        header = self.headers.get('Cookie', '')
        user = auth.get_account(header)
        identity = user['id'] if user else 'guest'
        if self.headers.get('X-Studio-Identity', identity) != identity:
            return None
        if user:
            return self.account_workspace(user)
        try:
            return owner_path(header)
        except CookieError:
            return None

    def require_account(self):
        user = auth.get_account(self.headers.get('Cookie', ''))
        if not user:
            self.reply(401, {'error': '请先登录。', 'code': 'auth-required', 'retryable': False})
            return None
        if self.headers.get('X-Studio-Identity', user['id']) != user['id']:
            self.reply(409, {'error': '登录状态已变化，请刷新页面。', 'code': 'identity', 'retryable': False})
            return None
        return user

    @staticmethod
    def account_workspace(user):
        path = auth.ROOT / 'workspaces' / user['id']
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        return path

    def auth_get(self, path):
        header = self.headers.get('Cookie', '')
        if path == '/api/auth/session':
            account = auth.get_account(header)
            return self.reply(200, {
                'account': auth.public_account(account) if account else None,
                'providers': [name for name in auth.PROVIDERS if auth.credentials(name)],
                'emailEnabled': auth.email_enabled()
            })
        parts = path.split('/')
        if len(parts) != 5 or parts[-1] != 'callback' or parts[-2] not in auth.PROVIDERS:
            return self.reply(404, {'error': '接口不存在。'})
        provider = parts[-2]
        target = BASE_PATH + '/#projects'
        session = None
        try:
            query = parse_qs(urlsplit(self.path).query)
            account = auth.oauth_account(provider, PUBLIC_ORIGIN or 'http://' + self.headers.get('Host', ''), query, header)
            session = auth.login_session(account, header)
        except (auth.AuthError, OSError, ValueError, TypeError, KeyError):
            target = BASE_PATH + '/?auth=failed#login'
        self.send_response(303)
        self.send_header('Location', target)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Set-Cookie', auth.cookie(auth.OAUTH_COOKIE, '', 0))
        if session:
            self.send_header('Set-Cookie', session)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def auth_post(self, path):
        if not self.same_origin():
            return self.reply(403, {'error': '仅接受本站请求。'})
        header = self.headers.get('Cookie', '')
        if path == '/api/auth/logout':
            return self.reply(200, {'ok': True}, auth.logout(header))
        try:
            if path in ('/api/auth/email/send', '/api/auth/email/verify'):
                length = int(self.headers.get('Content-Length', '0'))
                if self.headers.get_content_type() != 'application/json' or not 0 < length <= 4096:
                    raise ValueError()
                body = json.loads(self.rfile.read(length))
                if path.endswith('/send'):
                    return self.reply(200, auth.request_email_code(body.get('email')))
                account = auth.verify_email_code(body.get('email'), body.get('challenge'), body.get('code'))
                return self.reply(200, {'account': auth.public_account(account)}, auth.login_session(account, header))
            provider = path[len('/api/auth/'):]
            if provider in auth.PROVIDERS:
                origin = self.headers.get('Origin', '')
                if PUBLIC_ORIGIN and origin != PUBLIC_ORIGIN:
                    raise auth.AuthError('请从正式站点发起登录。')
                url, state = auth.oauth_start(provider, origin)
                return self.reply(200, {'url': url}, state)
            return self.reply(404, {'error': '接口不存在。'})
        except auth.AuthError as error:
            return self.reply(error.status, {'error': str(error)}, retry_after=error.retry_after)
        except (ValueError, AttributeError):
            return self.reply(400, {'error': '无法读取登录信息。'})

    def workspace_snapshot(self, write):
        parts = (self.app_path(self.path) or '').split('/')
        if len(parts) != 7 or parts[:4] != ['', 'api', 'workspace', 'projects']:
            return self.reply(404, {'error': '项目文件不存在。'})
        if write and not self.same_origin():
            return self.reply(403, {'error': '仅接受本站请求。'})
        try:
            if write:
                account = self.require_account()
                if not account:
                    return
                owner = self.account_workspace(account)
            else:
                owner = self.workspace_owner()
                if not owner:
                    return self.reply(404, {'error': '项目文件不存在。'})
            folder = snapshot_path(owner, *parts[4:])
            if not write:
                return self.reply(200, {'files': read_snapshot(folder)})
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 700000:
                return self.reply(413, {'error': '工作区文件超出大小限制。'})
            payload = json.loads(self.rfile.read(length))
            write_snapshot(folder, payload.get('files'))
            return self.reply(200, {'saved': True})
        except FileNotFoundError:
            return self.reply(404, {'error': '项目文件不存在。'})
        except (ValueError, AttributeError, UnicodeError):
            return self.reply(400, {'error': '无法读取工作区文件。'})
        except OSError:
            return self.reply(503, {'error': '工作区存储暂时不可用。'})

    def discovery_get(self, path):
        if path == '/api/discovery':
            return self.reply(200, {'projects': list_public()})
        slug = path[len('/api/discovery/'):]
        _, sep, tail = slug.partition('/')
        if sep and tail != 'cover':
            return self.reply(404, {'error': '作品不存在。'})
        try:
            record = read_public(slug.partition('/')[0])
            if not sep:
                return self.reply(200, record)
            name = next((name for name in record['files'] if is_image(name)), None)
            if not name:
                raise FileNotFoundError
            source = record['files'][name]
            body = decode_image(name, source)
            self.send_response(200)
            self.send_header('Content-Type', source[5:].split(';')[0])
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(body)
        except (FileNotFoundError, ValueError):
            return self.reply(404, {'error': '作品不存在。'})
        except (BrokenPipeError, ConnectionResetError):
            return

    def discovery_post(self):
        if not self.same_origin():
            return self.reply(403, {'error': '仅接受本站请求。'})
        account = self.require_account()
        if not account:
            return
        try:
            owner = self.account_workspace(account)
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 650000:
                return self.reply(413, {'error': '发布内容超出大小限制。'})
            payload = json.loads(self.rfile.read(length))
            return self.reply(201, publish(owner, payload))
        except FileNotFoundError:
            return self.reply(404, {'error': '找不到要分享的项目版本。'})
        except (ValueError, AttributeError):
            return self.reply(400, {'error': '发布信息无效。'})
        except OSError:
            return self.reply(503, {'error': '发现暂时不可用。'})

    def do_GET(self):
        path = self.app_path(self.path) or ''
        if path.startswith('/api/auth/'):
            return self.auth_get(path)
        if path == '/api/discovery' or path.startswith('/api/discovery/'):
            return self.discovery_get(path)
        if path.startswith('/api/workspace/'):
            return self.workspace_snapshot(write=False)
        return super().do_GET()

    def do_PUT(self):
        return self.workspace_snapshot(write=True)

    def copy_model_stream(self, response, model, stage):
        self.send_response(200)
        self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Accel-Buffering', 'no')
        self.send_header('Connection', 'close')
        self.close_connection = True

        def send(event):
            self.wfile.write(json.dumps(event, ensure_ascii=False).encode('utf-8') + b'\n')
            self.wfile.flush()

        try:
            self.end_headers()
            size = 0
            finished = False
            started = False
            for raw in response:
                if not raw.startswith(b'data:'):
                    continue
                event = raw[5:].strip()
                if event == b'[DONE]':
                    finished = True
                    break
                chunk = json.loads(event)
                if 'error' in chunk:
                    raise ValueError('model stream error')
                if not started:
                    send({'type': 'start', 'model': chunk.get('model') or model})
                    started = True
                for choice in chunk.get('choices', []):
                    if choice.get('index', 0) != 0:
                        continue
                    delta = (choice.get('delta') or {}).get('content')
                    if isinstance(delta, str) and delta:
                        size += len(delta.encode('utf-8'))
                        if size > 1000000:
                            raise ValueError('model stream too large')
                        send({'type': 'delta', 'text': delta})
                    if choice.get('finish_reason'):
                        finished = True
            if not finished:
                raise ValueError('incomplete stream')
            send({'type': 'done'})
        except (BrokenPipeError, ConnectionResetError):
            return
        except (OSError, HTTPException, ValueError, TypeError, AttributeError) as error:
            self.log_message('generation phase=%s stream_failure=%s', stage, type(error).__name__)
            try:
                send({'type': 'error', 'message': '文件输出连接中断。', 'retryable': True})
            except OSError:
                return

    def do_POST(self):
        path = self.app_path(self.path) or ''
        if path.startswith('/api/auth/'):
            return self.auth_post(path)
        if path == '/api/discovery':
            return self.discovery_post()
        if path == '/api/workspace/session':
            if not self.same_origin():
                return self.reply(403, {'error': '仅接受本站请求。'})
            account = self.require_account()
            if not account:
                return
            try:
                self.account_workspace(account)
                return self.reply(200, {'ready': True})
            except OSError:
                return self.reply(503, {'error': '工作区存储暂时不可用。'})
        if path != '/api/generate':
            return self.reply(404, {'error': '接口不存在。'})
        if not self.same_origin():
            return self.reply(403, {'error': '仅接受本站请求。'})
        if not self.require_account():
            return
        key = os.environ.get('LLM_API_KEY')
        base = os.environ.get('LLM_BASE_URL', 'https://api.openai.com/v1').rstrip('/')
        is_deepseek = urlsplit(base).hostname == 'api.deepseek.com'
        model = os.environ.get('LLM_MODEL') or (DEFAULT_DEEPSEEK_MODEL if is_deepseek else None)
        if LOCAL_AGENT and (urlsplit('//' + self.headers.get('Host', '')).hostname not in ('localhost','127.0.0.1')
                            or self.headers.get_content_type() != 'application/json'):
            return self.reply(403, {'error': '本机工具仅接受工作台请求。'})
        if not LOCAL_AGENT and (not key or not model):
            return self.reply(503, {'error': '生成服务尚未配置。', 'retryable': False})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 180000:
                return self.reply(413, {'error': '请求内容过长。'})
            data = json.loads(self.rfile.read(length))
            stage = data.get('stage', 'code')
            include_check = stage == 'plan' and data.get('includeCheck') is True
            prompt = data.get('prompt')
            previous = data.get('previous') or ''
            stream = data.get('stream') is True and stage in ('code', 'repair')
            if (not isinstance(stage, str) or stage not in SYSTEM or not isinstance(prompt, str)
                    or not prompt.strip() or len(prompt) > 24000 or not isinstance(previous, str)):
                raise ValueError()
        except (ValueError, AttributeError, UnicodeError):
            return self.reply(400, {'error': '请输入有效的需求。'})
        if not CAPACITY.acquire(blocking=False):
            return self.reply(429, {'error': '模型正在处理其他项目，请稍后再试。'}, retry_after=10)
        try:
            content = prompt + ('\n现有工作区或源码：\n' + previous if previous else '')
            instruction = SYSTEM[stage] + (ACCEPTANCE_PLAN if include_check else '')
            if LOCAL_AGENT:
                result = run_agent(instruction, content)
                if stage == 'plan':
                    result = planning_response(result, prompt, include_check)
                return self.reply(200, {'content': result, 'model': 'Codex CLI'})
            max_tokens = {'plan': 1100, 'review': 400}.get(stage, 6000)
            payload = {'model': model, 'messages': [
                {'role': 'system', 'content': instruction},
                {'role': 'user', 'content': content}], 'temperature': 0.2, 'max_tokens': max_tokens}
            if stream:
                payload['stream'] = True
            if is_deepseek:
                payload['thinking'] = {'type': 'disabled'}
                payload['response_format'] = {'type': 'json_object'}
            request = Request(base + '/chat/completions', data=json.dumps(payload).encode(),
                              headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
            with urlopen(request, timeout=90) as response:
                if stream and 'text/event-stream' in response.headers.get('Content-Type', ''):
                    return self.copy_model_stream(response, model, stage)
                result = json.load(response)
            answer = result['choices'][0]['message']['content']
            if stage == 'plan':
                answer = planning_response(answer, prompt, include_check)
            self.reply(200, {'content': answer, 'model': result.get('model') or model})
        except HTTPError as error:
            retryable = error.code == 429 or error.code >= 500
            self.log_message('generation phase=%s upstream_status=%d', stage, error.code)
            self.reply(502, {'error': '模型服务暂时不可用。', 'retryable': retryable},
                       retry_after=10 if error.code == 429 else None)
        except (subprocess.SubprocessError, OSError, ValueError, KeyError, TypeError, IndexError) as error:
            self.log_message('generation phase=%s failure=%s', stage, type(error).__name__)
            self.reply(502, {'error': '生成服务暂时未返回结果。'})
        finally:
            CAPACITY.release()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8000'))
    auth.setup()
    print(f'Atoms Studio: http://localhost:{port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1' if LOCAL_AGENT else os.environ.get('STUDIO_BIND', '0.0.0.0'), port), Handler).serve_forever()
