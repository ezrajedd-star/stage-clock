import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import type { Driver, Settings } from '../src/types';
import { handleStageReport, type Deps } from '../src/server/stageReport';
import { REPORT_MODEL, REPORT_WRITERS, FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, FIREBASE_WEB_API_KEY } from '../src/lib/reportConfig';
import firebaseConfig from '../firebase-applet-config.json';

const settings: Settings = { dnfPenalty: 60, dnfCalculationMethod: 'class', eventName: 'Test Rally' };
function mk(car: string, name: string, times: number[]): Driver {
  const stageTimes: Record<string, number> = {};
  times.forEach((t, i) => { stageTimes[String(i + 1)] = t; });
  return { id: `driver_${car}_A`, name, carNumber: car, class: 'A', stageTimes, stagePenalties: {}, totalTimeSeconds: 0, updatedAt: null };
}
const drivers = [mk('1', 'ALPHA', [100, 110]), mk('2', 'BRAVO', [101, 105])];

const GOOD = '#2 BRAVO wins SS2 in 01:45.00 and takes the lead by +00:04.00 from #1 ALPHA, now 2nd.';
const BAD = '#2 BRAVO wins SS2 in 01:44.00 and takes the lead from #1 ALPHA.';

const message = (text: string, stop: Anthropic.Beta.BetaMessage['stop_reason'] = 'end_turn') =>
  ({ id: 'msg', type: 'message', role: 'assistant', model: REPORT_MODEL, content: [{ type: 'text', text, citations: null }], stop_reason: stop, stop_sequence: null, usage: {} } as unknown as Anthropic.Beta.BetaMessage);

function deps(overrides: Partial<Deps> = {}): Deps {
  return {
    apiKey: () => 'sk-ant-test',
    verifyUser: async t => (t === 'good-token' ? 'ezrajedd@gmail.com' : t === 'staff-token' ? 'staff@example.com' : null),
    isOperator: async email => email === 'ezrajedd@gmail.com',
    loadData: async () => ({ drivers, settings }),
    createMessage: vi.fn(async () => message(GOOD)),
    ...overrides,
  };
}

const post = (body: unknown, token = 'good-token') =>
  new Request('http://localhost/api/stage-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

describe('POST /api/stage-report', () => {
  it('returns a verified draft for an operator', async () => {
    const d = deps();
    const res = await handleStageReport(post({ stage: 2, format: 'summary' }), d);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ draft: GOOD, verified: true, attempts: 1, stageLabel: 'SS2', provisional: false, issues: [] });
  });

  it('sends the fact sheet, format, notes and accuracy rules to the configured model', async () => {
    const d = deps();
    await handleStageReport(post({ stage: 2, format: 'social', notes: 'rain from SS2', hashtags: true }), d);
    const params = (d.createMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(params.model).toBe(REPORT_MODEL);
    expect(params.fallbacks).toBe('default');
    expect(params.system).toContain('Copy every time, gap and penalty digit for digit');
    expect(params.system).toContain('Never compare classes yourself');
    expect(params.system).toContain('Never mock or belittle');
    expect(params.system).toContain('thrilling, electrifying');
    expect(params.system).toContain('Opinions about people in the notes');
    expect(params.system).toContain("Don't read out a results table");
    expect(params.system).toContain('rivalRetiredThisStage');
    expect(params.system).toContain('never quote it');
    expect(params.system).toContain('"crews" ("vehicle")');
    expect(params.system).toContain('10th and above in figures');
    expect(params.output_config).toEqual({ effort: 'high' });
    const user = params.messages[0].content as string;
    expect(user).toContain('SOCIAL POST');
    expect(user).toContain('"label":"SS2"');
    expect(user).toContain('"name":"Test Rally"');
    expect(user).toContain('rain from SS2');
  });

  it('uses the standard writer by default and the premium writer when chosen', async () => {
    const d = deps();
    const std = await (await handleStageReport(post({ stage: 2, format: 'summary' }), d)).json();
    const prem = await (await handleStageReport(post({ stage: 2, format: 'social', writer: 'premium' }), d)).json();
    const calls = (d.createMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1]).toMatchObject({ model: REPORT_WRITERS.standard.model, output_config: { effort: 'high' }, max_tokens: 16000 });
    expect(calls[1][1]).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'high' }, max_tokens: 16000, fallbacks: 'default' });
    expect([std.writer, prem.writer]).toEqual(['standard', 'premium']);
  });

  it('writes a whole-rally report from SS1 up to the chosen stage', async () => {
    const d = deps();
    const body = await (await handleStageReport(post({ stage: 2, format: 'summary', scope: 'rally', writer: 'premium' }), d)).json();
    expect(body).toMatchObject({ scope: 'rally', stageLabel: 'SS1–SS2', verified: true });
    const user = (d.createMessage as ReturnType<typeof vi.fn>).mock.calls[0][1].messages[0].content as string;
    expect(user).toContain('RALLY REPORT');
    expect(user).toContain('"kind":"rally"');
    expect(user).toContain('"stageByStage"');
    expect(user).toContain('rally report covering SS1–SS2 of Test Rally');
  });

  it('defaults to a single-stage report and rejects an unknown scope', async () => {
    const body = await (await handleStageReport(post({ stage: 2, format: 'summary' }), deps())).json();
    expect(body).toMatchObject({ scope: 'stage', stageLabel: 'SS2' });
    expect((await handleStageReport(post({ stage: 2, format: 'summary', scope: 'season' }), deps())).status).toBe(400);
    expect((await handleStageReport(post({ stage: 2, format: 'toString' }), deps())).status).toBe(400);
  });

  it('rejects an unknown writer', async () => {
    expect((await handleStageReport(post({ stage: 2, format: 'summary', writer: 'gpt' }), deps())).status).toBe(400);
  });

  it('regenerates once with the mismatches when the check fails', async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(message(BAD)).mockResolvedValueOnce(message(GOOD));
    const res = await handleStageReport(post({ stage: 2, format: 'summary' }), deps({ createMessage }));
    const body = await res.json();
    expect(body).toMatchObject({ draft: GOOD, verified: true, attempts: 2 });
    const retry = createMessage.mock.calls[1][1];
    expect(retry.messages).toHaveLength(3);
    expect(retry.messages[2].content).toContain('"01:44.00"');
  });

  it('returns the draft flagged as unverified, with issues, if the retry also fails', async () => {
    const createMessage = vi.fn().mockResolvedValue(message(BAD));
    const body = await (await handleStageReport(post({ stage: 2, format: 'summary' }), deps({ createMessage }))).json();
    expect(body.verified).toBe(false);
    expect(body.attempts).toBe(2);
    expect(body.issues[0]).toMatchObject({ kind: 'time', text: '01:44.00' });
  });

  it('rejects requests without a valid sign-in, and non-operators', async () => {
    expect((await handleStageReport(post({ stage: 2, format: 'summary' }, ''), deps())).status).toBe(401);
    expect((await handleStageReport(post({ stage: 2, format: 'summary' }, 'forged'), deps())).status).toBe(401);
    const res = await handleStageReport(post({ stage: 2, format: 'summary' }, 'staff-token'), deps());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('NOT_OPERATOR');
  });

  it('reports a missing API key clearly', async () => {
    const res = await handleStageReport(post({ stage: 2, format: 'summary' }), deps({ apiKey: () => undefined }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('NO_API_KEY');
  });

  it('reports a stage with no results', async () => {
    const res = await handleStageReport(post({ stage: 5, format: 'summary' }), deps());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('NO_RESULTS');
  });

  it('rejects bad input', async () => {
    expect((await handleStageReport(post({ stage: 13, format: 'summary' }), deps())).status).toBe(400);
    expect((await handleStageReport(post({ stage: 2, format: 'press_release' }), deps())).status).toBe(400);
    expect((await handleStageReport(post({ stage: 2, format: 'summary', notes: 'x'.repeat(1001) }), deps())).status).toBe(400);
  });

  it('maps rate limits, network failures, outages, bad keys and refusals to clear errors', async () => {
    const cases: [unknown, number, string][] = [
      [new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers({ 'retry-after': '30' })), 429, 'RATE_LIMITED'],
      [new Anthropic.APIConnectionError({ message: 'socket hang up' }), 504, 'AI_UNREACHABLE'],
      [new Anthropic.InternalServerError(529, {}, 'overloaded', new Headers()), 503, 'AI_BUSY'],
      [new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', new Headers()), 502, 'INVALID_API_KEY'],
    ];
    for (const [error, status, code] of cases) {
      const res = await handleStageReport(post({ stage: 2, format: 'summary' }), deps({ createMessage: vi.fn().mockRejectedValue(error) }));
      expect([res.status, (await res.json()).error]).toEqual([status, code]);
    }
    const refused = await handleStageReport(post({ stage: 2, format: 'summary' }), deps({ createMessage: vi.fn().mockResolvedValue(message('', 'refusal')) }));
    expect((await refused.json()).error).toBe('AI_REFUSED');
  });

  it('reports a database failure', async () => {
    const res = await handleStageReport(post({ stage: 2, format: 'summary' }), deps({ loadData: async () => { throw new Error('down'); } }));
    expect((await res.json()).error).toBe('DATA_UNAVAILABLE');
  });

  it('only accepts POST', async () => {
    expect((await handleStageReport(new Request('http://localhost/api/stage-report'), deps())).status).toBe(405);
  });
});

describe('server Firebase identifiers', () => {
  it('match firebase-applet-config.json', () => {
    expect(FIREBASE_PROJECT_ID).toBe(firebaseConfig.projectId);
    expect(FIRESTORE_DATABASE_ID).toBe(firebaseConfig.firestoreDatabaseId);
    expect(FIREBASE_WEB_API_KEY).toBe(firebaseConfig.apiKey);
  });
});
