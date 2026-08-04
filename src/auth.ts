const SITE_PASSWORD_HASH = '9f85febe12520f8b2a5f41df76ced1b05e0bd049e9f7f8549121e8745e876828';
const SETTINGS_PASSWORD_HASH = '87799c48b5b35faca84b45205f27a46de89b9e41c17e8056e38d0e5e2523201f';
const THIRTY_DAYS = 30 * 24 * 60 * 60;

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

async function sign(scope: string, expires: number): Promise<string> {
  const secret = scope === 'settings' ? SETTINGS_PASSWORD_HASH : SITE_PASSWORD_HASH;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${scope}.${expires}`))));
}

function cookieValue(request: Request, name: string): string {
  const cookies = request.headers.get('cookie') || '';
  for (const part of cookies.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

async function validToken(token: string, scope: string): Promise<boolean> {
  const [expiresText, signature] = token.split('.');
  const expires = Number(expiresText);
  if (!expires || expires <= Math.floor(Date.now() / 1000) || !signature) return false;
  return signature === await sign(scope, expires);
}

export async function hasSiteAccess(request: Request): Promise<boolean> {
  return validToken(cookieValue(request, 'report_session'), 'site');
}

export async function hasSettingsAccess(request: Request): Promise<boolean> {
  return validToken(cookieValue(request, 'report_settings'), 'settings');
}

function sessionCookie(name: string, token: string): string {
  return `${name}=${encodeURIComponent(token)}; Max-Age=${THIRTY_DAYS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function createSession(scope: 'site' | 'settings'): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + THIRTY_DAYS;
  return `${expires}.${await sign(scope, expires)}`;
}

function safeNext(value: unknown): string {
  const path = String(value || '/');
  return path.startsWith('/') && !path.startsWith('//') ? path : '/';
}

export function loginPage(next = '/', invalid = false): Response {
  const safePath = safeNext(next);
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Đăng nhập | Report ALF</title><link rel="icon" href="/FAVICON.png"><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f7fb;color:#10213a;font-family:Inter,Arial,sans-serif}.login{width:min(390px,calc(100% - 32px));padding:32px;border:1px solid #d8e2ee;border-radius:14px;background:#fff;box-shadow:0 20px 55px rgba(28,48,78,.12)}.brand{display:flex;align-items:center;gap:10px;margin-bottom:28px}.mark{width:8px;height:30px;border-radius:4px;background:#1689e8}.brand strong{font-size:16px}.brand small{display:block;color:#71829a;font-size:8px;letter-spacing:.18em}.login h1{margin:0;font-size:25px}.login p{margin:8px 0 22px;color:#71829a;font-size:12px}.field{display:grid;gap:7px}.field span{font-size:11px;font-weight:700}.field input{width:100%;padding:12px;border:1px solid #ccd8e6;border-radius:8px;font-size:14px;outline:0}.field input:focus{border-color:#2563eb}.error{margin:0 0 14px!important;padding:10px;border-radius:7px;background:#fff1f2!important;color:#dc2626!important}.button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:700}</style></head><body><form class="login" method="post" action="/auth/login"><div class="brand"><span class="mark"></span><span><strong>REPORT</strong><small>ANLANHFARM</small></span></div><h1>Đăng nhập báo cáo</h1><p>Nhập mật khẩu để tiếp tục.</p>${invalid ? '<p class="error">Mật khẩu không đúng.</p>' : ''}<input type="hidden" name="next" value="${safePath.replace(/"/g, '&quot;')}"><label class="field"><span>Mật khẩu</span><input name="password" type="password" autocomplete="current-password" autofocus required></label><button class="button" type="submit">Đăng nhập</button></form></body></html>`;
  return new Response(html, { status: invalid ? 401 : 200, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' } });
}

export async function handleAuth(request: Request, url: URL): Promise<Response> {
  if (url.pathname === '/auth/login' && request.method === 'GET') return loginPage(url.searchParams.get('next') || '/');
  if (url.pathname === '/auth/login' && request.method === 'POST') {
    const form = await request.formData();
    const next = safeNext(form.get('next'));
    if (await sha256(String(form.get('password') || '')) !== SITE_PASSWORD_HASH) return loginPage(next, true);
    return new Response(null, { status: 303, headers: { Location: next, 'Set-Cookie': sessionCookie('report_session', await createSession('site')) } });
  }
  if (url.pathname === '/auth/settings' && request.method === 'GET') {
    return Response.json({ ok: await hasSettingsAccess(request) }, { status: await hasSettingsAccess(request) ? 200 : 401 });
  }
  if (url.pathname === '/auth/settings' && request.method === 'POST') {
    const body: { password?: string } = await request.json<{ password?: string }>().catch(() => ({}));
    if (await sha256(String(body.password || '')) !== SETTINGS_PASSWORD_HASH) return Response.json({ ok: false, error: 'Mật khẩu quản trị không đúng.' }, { status: 401 });
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('report_settings', await createSession('settings')) } });
  }
  return Response.json({ ok: false, error: 'Auth route not found.' }, { status: 404 });
}
