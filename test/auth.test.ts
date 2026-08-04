import { describe, expect, it } from 'vitest';
import { handleAuth, hasSettingsAccess, hasSiteAccess } from '../src/auth';

function cookieFrom(response: Response): string {
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

describe('report access layers', () => {
  it('creates a valid site session only for the report password', async () => {
    const invalidBody = new URLSearchParams({ password: 'wrong', next: '/' });
    const invalid = await handleAuth(new Request('https://report.test/auth/login', { method: 'POST', body: invalidBody }), new URL('https://report.test/auth/login'));
    expect(invalid.status).toBe(401);

    const body = new URLSearchParams({ password: 'anlanh@1234', next: '/tuan-31-2026' });
    const response = await handleAuth(new Request('https://report.test/auth/login', { method: 'POST', body }), new URL('https://report.test/auth/login'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/tuan-31-2026');
    expect(await hasSiteAccess(new Request('https://report.test/', { headers: { Cookie: cookieFrom(response) } }))).toBe(true);
  });

  it('uses a separate session for popup settings', async () => {
    const response = await handleAuth(new Request('https://report.test/auth/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'hieu83' })
    }), new URL('https://report.test/auth/settings'));
    expect(response.status).toBe(200);
    expect(await hasSettingsAccess(new Request('https://report.test/', { headers: { Cookie: cookieFrom(response) } }))).toBe(true);
  });
});
