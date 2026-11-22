/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Server side of "Close leg & publish". Runs as a Vercel Function (api/close-leg.ts) and, in
// development, inside the Vite dev server. It checks the caller is the admin, then asks GitHub to
// run the PARX Open "Import results from Stage Clock" workflow for the chosen leg
// (repository_dispatch). The workflow reads the results straight from Firestore (public read),
// so nothing from the browser is trusted except the leg slug, which is validated.
//
// Environment: PARX_GITHUB_TOKEN (fine-grained token: PARX Open repository only, Contents: read and write),
// optional PARX_GITHUB_REPO (owner/name, default below).

import { defaultDeps as reportDeps } from './stageReport.js';
import { ADMIN_EMAIL } from '../lib/reportConfig.js';
import { CLOSE_LEG_ERRORS, DEFAULT_PARX_REPO, LEG_SLUG_RE, PARX_DISPATCH_EVENT, type CloseLegErrorCode } from '../lib/parxConfig.js';

export interface CloseLegDeps {
  verifyUser: (idToken: string) => Promise<string | null>;
  githubToken: () => string | undefined;
  repo: () => string;
  dispatch: (url: string, init: RequestInit) => Promise<Response>;
}

export const defaultCloseLegDeps: CloseLegDeps = {
  verifyUser: reportDeps.verifyUser,
  githubToken: () => process.env.PARX_GITHUB_TOKEN?.trim() || undefined,
  repo: () => process.env.PARX_GITHUB_REPO?.trim() || DEFAULT_PARX_REPO,
  dispatch: (url, init) => fetch(url, init),
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const fail = (code: CloseLegErrorCode, status: number) => json(status, { error: code, message: CLOSE_LEG_ERRORS[code] });

export async function handleCloseLeg(request: Request, deps: CloseLegDeps = defaultCloseLegDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const email = token ? await deps.verifyUser(token) : null;
  if (!email) return fail('UNAUTHENTICATED', 401);
  if (email !== ADMIN_EMAIL) return fail('FORBIDDEN', 403);

  let leg: unknown;
  try {
    leg = ((await request.json()) as { leg?: unknown })?.leg;
  } catch {
    return fail('BAD_REQUEST', 400);
  }
  if (typeof leg !== 'string' || leg.length > 64 || !LEG_SLUG_RE.test(leg)) return fail('BAD_REQUEST', 400);

  const gh = deps.githubToken();
  if (!gh) return fail('NOT_CONFIGURED', 503);
  const repo = deps.repo();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return fail('NOT_CONFIGURED', 503);

  let res: Response;
  try {
    res = await deps.dispatch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${gh}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'stage-clock',
      },
      body: JSON.stringify({ event_type: PARX_DISPATCH_EVENT, client_payload: { leg, closedBy: email } }),
    });
  } catch {
    return fail('NETWORK', 502);
  }
  if (res.status !== 204 && !res.ok) return fail('GITHUB_REJECTED', 502);
  return json(200, { ok: true, leg, actionsUrl: `https://github.com/${repo}/actions/workflows/stage-clock-import.yml` });
}
