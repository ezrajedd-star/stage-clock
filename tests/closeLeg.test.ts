import { describe, expect, it, vi } from 'vitest';
import { handleCloseLeg, type CloseLegDeps } from '../src/server/closeLeg';
import { checkBeforeClose } from '../src/lib/closeLegCheck';
import type { Driver } from '../src/types';

function deps(overrides: Partial<CloseLegDeps> = {}): CloseLegDeps {
  return {
    verifyUser: async t => (t === 'admin-token' ? 'ezrajedd@gmail.com' : t === 'staff-token' ? 'staff@example.com' : null),
    githubToken: () => 'github_pat_test',
    repo: () => 'ezrajedd-star/PARX-Open-MVP-Website',
    dispatch: vi.fn(async () => new Response(null, { status: 204 })),
    ...overrides,
  };
}
const post = (body: unknown, token: string | null = 'admin-token') =>
  new Request('http://localhost/api/close-leg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /api/close-leg', () => {
  it('dispatches the PARX import for the admin', async () => {
    const d = deps();
    const res = await handleCloseLeg(post({ leg: 'ormoc' }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, leg: 'ormoc' });
    const [url, init] = (d.dispatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/ezrajedd-star/PARX-Open-MVP-Website/dispatches');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer github_pat_test');
    expect(JSON.parse(init.body as string)).toEqual({ event_type: 'stage-clock-leg-closed', client_payload: { leg: 'ormoc', closedBy: 'ezrajedd@gmail.com' } });
  });

  it('rejects missing or invalid sign-in', async () => {
    expect((await handleCloseLeg(post({ leg: 'ormoc' }, null), deps())).status).toBe(401);
    expect((await handleCloseLeg(post({ leg: 'ormoc' }, 'bad'), deps())).status).toBe(401);
  });

  it('only lets the admin publish', async () => {
    const d = deps();
    const res = await handleCloseLeg(post({ leg: 'ormoc' }, 'staff-token'), d);
    expect(res.status).toBe(403);
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('validates the leg slug', async () => {
    for (const leg of ['', 'Ormoc', '../x', 'a b', 42, 'x'.repeat(65)]) {
      expect((await handleCloseLeg(post({ leg }), deps())).status).toBe(400);
    }
    expect((await handleCloseLeg(post('not json'), deps())).status).toBe(400);
  });

  it('explains a missing token', async () => {
    const res = await handleCloseLeg(post({ leg: 'ormoc' }), deps({ githubToken: () => undefined }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('NOT_CONFIGURED');
  });

  it('reports GitHub refusals and network errors', async () => {
    expect((await (await handleCloseLeg(post({ leg: 'ormoc' }), deps({ dispatch: async () => new Response('{}', { status: 404 }) }))).json()).error).toBe('GITHUB_REJECTED');
    expect((await (await handleCloseLeg(post({ leg: 'ormoc' }), deps({ dispatch: async () => { throw new Error('offline'); } }))).json()).error).toBe('NETWORK');
  });

  it('only accepts POST', async () => {
    expect((await handleCloseLeg(new Request('http://localhost/api/close-leg'), deps())).status).toBe(405);
  });
});

describe('checkBeforeClose', () => {
  const mk = (name: string, car: string, times: (number | undefined)[], extra: Partial<Driver> = {}): Driver => ({
    id: `driver_${car}`, name, carNumber: car, class: 'A',
    stageTimes: Object.fromEntries(times.map((t, i) => [String(i + 1), t]).filter(([, t]) => t !== undefined)),
    stagePenalties: {}, totalTimeSeconds: 0, updatedAt: null, ...extra,
  });

  it('lists crews missing times on stages others ran, ignoring hidden rows and all-DNS crews', () => {
    const c = checkBeforeClose([
      mk('Alpha', '1', [60, 61, 62]),
      mk('Bravo', '2', [undefined, undefined, 70]),
      mk('Charlie', '3', [-2, -2, -2]),
      mk('Test', '9', [1], { isHidden: true }),
    ]);
    expect(c).toMatchObject({ visible: 3, hidden: 1, stageCount: 3, duplicateNames: [] });
    expect(c.incomplete).toEqual([{ name: 'Bravo', carNumber: '2', class: 'A', missing: [1, 2] }]);
  });

  it('flags the same driver on two visible rows', () => {
    expect(checkBeforeClose([mk('Mye', '27', [60]), mk('MYE', '52', [61])]).duplicateNames).toEqual(['Mye #27 / MYE #52']);
  });
});
