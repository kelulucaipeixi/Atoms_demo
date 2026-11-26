"""Accounts, expiring sessions and browser-bound OAuth state."""
import base64
from contextlib import closing, contextmanager
import hashlib
import hmac
from http.cookies import SimpleCookie, CookieError
import json
import os
import re
import secrets
import sqlite3
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from workspace_store import BASE_PATH, ROOT

SESSION_COOKIE = 'studio_account'
OAUTH_COOKIE = 'studio_oauth'
SESSION_TIME = 30 * 86400
OAUTH_TIME = 600
CODE_TIME = 600
CODE_COOLDOWN = 60
CODE_ATTEMPTS = 5
CODE_KEY = ROOT / '.email-code-key'
EMAIL = re.compile(r'[^\s@]+@[^\s@]+\.[^\s@]+')
PROVIDERS = {
    'google': ('https://accounts.google.com/o/oauth2/v2/auth',
               'https://oauth2.googleapis.com/token', 'openid email profile'),
    'github': ('https://github.com/login/oauth/authorize',
               'https://github.com/login/oauth/access_token', 'read:user user:email'),
}


class AuthError(Exception):
    def __init__(self, message, status=400, retry_after=None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


def setup():
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    with database() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY, provider TEXT NOT NULL, subject TEXT NOT NULL,
                email TEXT NOT NULL, name TEXT NOT NULL, password TEXT,
                UNIQUE(provider, subject)
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS oauth (
                state TEXT PRIMARY KEY, provider TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS email_attempts (
                bucket TEXT NOT NULL, at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS email_attempt_lookup ON email_attempts(bucket, at);
            CREATE TABLE IF NOT EXISTS email_codes (
                challenge TEXT PRIMARY KEY, address TEXT NOT NULL, digest TEXT NOT NULL,
                expires INTEGER NOT NULL, attempts INTEGER NOT NULL
            );
        """)
    (ROOT / 'accounts.sqlite').chmod(0o600)
    if not CODE_KEY.exists():
        with tempfile.NamedTemporaryFile(dir=ROOT) as source:
            source.write(secrets.token_bytes(32))
            source.flush()
            try:
                os.link(source.name, CODE_KEY)
            except FileExistsError:
                pass


@contextmanager
def database():
    with closing(sqlite3.connect(ROOT / 'accounts.sqlite', timeout=8)) as conn, conn:
        conn.row_factory = sqlite3.Row
        yield conn


def fingerprint(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def cookie_token(header, name):
    jar = SimpleCookie()
    try:
        jar.load(header)
    except CookieError:
        return ''
    value = jar[name].value if name in jar else ''
    return value if re.fullmatch(r'[-_A-Za-z0-9]{43}', value) else ''


def cookie(name, value, seconds):
    secure = '; Secure' if os.environ.get('STUDIO_SECURE_COOKIE') == '1' else ''
    return f'{name}={value}; Path={BASE_PATH}/; Max-Age={seconds}; HttpOnly; SameSite=Lax{secure}'


def public_account(account):
    return {key: account[key] for key in ('id', 'email', 'name')}


def get_account(header):
    token = cookie_token(header, SESSION_COOKIE)
    if not token:
        return None
    with database() as conn:
        return conn.execute(
            'SELECT accounts.id, email, name FROM sessions JOIN accounts ON account=accounts.id '
            'WHERE token=? AND expires>?',
            (fingerprint(token), int(time.time()))
        ).fetchone()


def login_session(account, header):
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    previous = cookie_token(header, SESSION_COOKIE)
    with database() as conn:
        conn.execute('DELETE FROM sessions WHERE expires<=? OR token=?', (now, fingerprint(previous)))
        conn.execute('INSERT INTO sessions VALUES (?, ?, ?)', (fingerprint(token), account['id'], now + SESSION_TIME))
    return cookie(SESSION_COOKIE, token, SESSION_TIME)


def logout(header):
    with database() as conn:
        conn.execute('DELETE FROM sessions WHERE token=?', (fingerprint(cookie_token(header, SESSION_COOKIE)),))
    return cookie(SESSION_COOKIE, '', 0)


def email_address(email):
    address = email.strip().lower() if isinstance(email, str) else ''
    if len(address) > 254 or not EMAIL.fullmatch(address):
        raise AuthError('请输入有效的邮箱。')
    return address


def email_enabled():
    return bool(os.environ.get('RESEND_API_KEY', '').strip() and os.environ.get('STUDIO_EMAIL_FROM', '').strip())


def code_digest(challenge, address, code):
    return hmac.new(CODE_KEY.read_bytes(), f'{challenge}:{address}:{code}'.encode('utf-8'), 'sha256').hexdigest()


def send_email(address, code, challenge):
    payload = json.dumps({
        'from': os.environ['STUDIO_EMAIL_FROM'].strip(),
        'to': [address],
        'subject': '应用工坊登录验证码',
        'text': f'你的应用工坊登录验证码是 {code}。验证码 10 分钟内有效，仅可使用一次。'
                '如果你没有尝试登录，可以忽略这封邮件。'
    }).encode()
    request = Request('https://api.resend.com/emails', data=payload, headers={
        'Authorization': 'Bearer ' + os.environ['RESEND_API_KEY'].strip(),
        'Content-Type': 'application/json',
        'User-Agent': 'Atoms-Studio',
        'Idempotency-Key': 'atoms-login-' + challenge
    })
    with urlopen(request, timeout=12) as response:
        if not json.load(response).get('id'):
            raise OSError('Missing mail delivery identifier')


def request_email_code(email):
    address = email_address(email)
    if not email_enabled():
        raise AuthError('邮箱登录暂时不可用。', 503)
    now = int(time.time())
    challenge = secrets.token_urlsafe(32)
    code = f'{secrets.randbelow(1_000_000):06d}'
    token = fingerprint(challenge)
    bucket = 'code:' + fingerprint(address)
    with database() as conn:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('DELETE FROM email_attempts WHERE at<=?', (now - 900,))
        conn.execute('DELETE FROM email_codes WHERE expires<=?', (now,))
        count, last, first = conn.execute(
            'SELECT count(*), max(at), min(at) FROM email_attempts WHERE bucket=?', (bucket,)
        ).fetchone()
        if last is not None and now - last < CODE_COOLDOWN:
            raise AuthError('发送过于频繁，请稍后重试。', 429, CODE_COOLDOWN - (now - last))
        if count >= 5:
            raise AuthError('验证码发送次数过多，请稍后重试。', 429, 900 - (now - first))
        total = conn.execute(
            'SELECT count(*) FROM email_attempts WHERE bucket=? AND at>?', ('code:all', now - 60)
        ).fetchone()[0]
        if total >= 30:
            raise AuthError('邮件服务繁忙，请稍后重试。', 429, 60)
        conn.executemany('INSERT INTO email_attempts VALUES (?, ?)', [(bucket, now), ('code:all', now)])
        conn.execute('INSERT INTO email_codes VALUES (?, ?, ?, ?, ?)',
                     (token, address, code_digest(challenge, address, code), now + CODE_TIME, CODE_ATTEMPTS))
    try:
        send_email(address, code, challenge)
    except (OSError, ValueError, TypeError, AttributeError) as error:
        with database() as conn:
            conn.execute('DELETE FROM email_codes WHERE challenge=?', (token,))
        if isinstance(error, HTTPError):
            error.close()
        raise AuthError('暂时无法发送验证码，请稍后重试。', 502, CODE_COOLDOWN) from error
    return {'challenge': challenge, 'resendAfter': CODE_COOLDOWN}


def verify_email_code(email, challenge, code):
    address = email_address(email)
    if not isinstance(challenge, str) or not re.fullmatch(r'[-_A-Za-z0-9]{43}', challenge):
        raise AuthError('请先获取验证码。')
    if not isinstance(code, str) or not re.fullmatch(r'[0-9]{6}', code):
        raise AuthError('请输入 6 位数字验证码。')
    token = fingerprint(challenge)
    with database() as conn:
        conn.execute('BEGIN IMMEDIATE')
        record = conn.execute('SELECT * FROM email_codes WHERE challenge=? AND address=? AND expires>?',
                              (token, address, int(time.time()))).fetchone()
        if not record:
            raise AuthError('验证码已过期，请重新发送。', 401)
        if hmac.compare_digest(record['digest'], code_digest(challenge, address, code)):
            conn.execute('DELETE FROM email_codes WHERE challenge=?', (token,))
            conn.execute('INSERT OR IGNORE INTO accounts VALUES (?, ?, ?, ?, ?, NULL)',
                         (secrets.token_hex(32), 'email', address, address, address.split('@')[0][:40]))
            conn.execute('UPDATE accounts SET password=NULL WHERE provider=? AND subject=?', ('email', address))
            return conn.execute('SELECT * FROM accounts WHERE provider=? AND subject=?', ('email', address)).fetchone()
        if record['attempts'] > 1:
            conn.execute('UPDATE email_codes SET attempts=attempts-1 WHERE challenge=?', (token,))
        else:
            conn.execute('DELETE FROM email_codes WHERE challenge=?', (token,))
    raise AuthError('验证码不正确。' if record['attempts'] > 1 else '尝试次数已用完，请重新发送验证码。', 401)


def credentials(provider):
    if provider not in PROVIDERS:
        return None
    fields = [os.environ.get(provider.upper() + '_CLIENT_' + field, '').strip() for field in ('ID', 'SECRET')]
    return fields if all(fields) else None


def callback_url(origin, provider):
    return origin + BASE_PATH + '/api/auth/' + provider + '/callback'


def oauth_start(provider, origin):
    client = credentials(provider)
    if not client:
        raise AuthError('此登录方式暂未启用。', 503)
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    now = int(time.time())
    with database() as conn:
        conn.execute('DELETE FROM oauth WHERE expires<=?', (now,))
        conn.execute('INSERT INTO oauth VALUES (?, ?, ?, ?)', (fingerprint(state), provider, verifier, now + OAUTH_TIME))
    authorize_url, _, scope = PROVIDERS[provider]
    query = urlencode({'client_id': client[0], 'redirect_uri': callback_url(origin, provider),
                       'response_type': 'code', 'scope': scope, 'state': state,
                       'code_challenge': challenge, 'code_challenge_method': 'S256'})
    return authorize_url + '?' + query, cookie(OAUTH_COOKIE, state, OAUTH_TIME)


def provider_request(url, *, data=None, token=None):
    headers = {'Accept': 'application/json', 'User-Agent': 'Atoms-Studio'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = Request(url, data=urlencode(data).encode() if data else None, headers=headers)
    with urlopen(req, timeout=12) as response:
        return json.load(response)


def oauth_account(provider, origin, query, header):
    client = credentials(provider)
    code, state = (query.get(key, [''])[0] for key in ('code', 'state'))
    browser_state = cookie_token(header, OAUTH_COOKIE)
    if not client or not code or len(code) > 2048 or not browser_state or not hmac.compare_digest(state, browser_state):
        raise AuthError('登录链接无效或已过期。')
    digest = fingerprint(state)
    with database() as conn:
        conn.execute('BEGIN IMMEDIATE')
        saved = conn.execute('SELECT verifier FROM oauth WHERE state=? AND provider=? AND expires>?',
                             (digest, provider, int(time.time()))).fetchone()
        if not saved:
            raise AuthError('登录链接无效或已过期。')
        conn.execute('DELETE FROM oauth WHERE state=?', (digest,))
    token = provider_request(PROVIDERS[provider][1], data={
        'client_id': client[0], 'client_secret': client[1], 'code': code,
        'redirect_uri': callback_url(origin, provider), 'code_verifier': saved['verifier'],
        'grant_type': 'authorization_code'
    }).get('access_token')
    if not isinstance(token, str) or not token:
        raise AuthError('登录提供方未完成授权。')
    if provider == 'google':
        profile = provider_request('https://openidconnect.googleapis.com/v1/userinfo', token=token)
        subject = profile.get('sub')
        email = profile.get('email') if profile.get('email_verified') is True else ''
    else:
        profile = provider_request('https://api.github.com/user', token=token)
        subject = str(profile['id']) if isinstance(profile.get('id'), int) else ''
        emails = provider_request('https://api.github.com/user/emails', token=token)
        email = next((e['email'] for e in emails if e.get('primary') and e.get('verified') and e.get('email')), '')
    if not isinstance(subject, str) or not subject:
        raise AuthError('登录提供方未返回账户信息。')
    email = email if isinstance(email, str) else ''
    name = str(profile.get('name') or profile.get('login') or email.split('@')[0] or '我的工作区').strip()[:40]
    with database() as conn:
        conn.execute('INSERT OR IGNORE INTO accounts VALUES (?, ?, ?, ?, ?, NULL)',
                     (secrets.token_hex(32), provider, subject, email[:254], name))
        return conn.execute('SELECT * FROM accounts WHERE provider=? AND subject=?', (provider, subject)).fetchone()
