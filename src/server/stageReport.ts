/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Server side of the Stage Report Writer. Runs as a Vercel Function
// (api/stage-report.ts) and, in development, inside the Vite dev server.
// The Anthropic API key is read here from the environment and never sent to the browser.

import Anthropic from '@anthropic-ai/sdk';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Driver, Settings } from '../types';
import { buildFactSheet, stageHasResults } from '../lib/factSheet.js';
import { verifyDraft, type DraftIssue } from '../lib/verifyDraft.js';
import { SYSTEM_PROMPT, buildUserMessage, buildCorrectionMessage } from '../lib/reportPrompt.js';
import { decodeDriver, decodeSettings, type RestDocument } from '../lib/firestoreRest.js';
import {
  ADMIN_EMAIL, FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, FIREBASE_WEB_API_KEY,
  REPORT_MODEL, REPORT_FORMATS, REPORT_ERRORS, MAX_NOTES_LENGTH, MAX_EVENT_NAME_LENGTH,
  type ReportErrorCode, type ReportFormat, type ReportResponse,
} from '../lib/reportConfig.js';

const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents`;
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

export interface Deps {
  apiKey: () => string | undefined;
  // Verifies a Firebase ID token and returns the signed-in user's verified email.
  verifyUser: (idToken: string) => Promise<string | null>;
  isOperator: (email: string, idToken: string) => Promise<boolean>;
  loadData: () => Promise<{ drivers: Driver[]; settings: Settings }>;
  createMessage: (apiKey: string, params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;
}

export const defaultDeps: Deps = {
  apiKey: () => process.env.ANTHROPIC_API_KEY?.trim() || undefined,

  async verifyUser(idToken) {
    try {
      const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
        issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
        audience: FIREBASE_PROJECT_ID,
      });
      return payload.email_verified === true && typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    } catch {
      return null;
    }
  },

  async isOperator(email, idToken) {
    if (email === ADMIN_EMAIL) return true;
    // Firestore rules let a signed-in user read their own /operators document.
    const res = await fetch(`${FIRESTORE}/operators/${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    return res.ok;
  },

  async loadData() {
    const [driversRes, settingsRes] = await Promise.all([
      fetch(`${FIRESTORE}:runQuery?key=${FIREBASE_WEB_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'drivers' }] } }),
      }),
      fetch(`${FIRESTORE}/settings/global?key=${FIREBASE_WEB_API_KEY}`),
    ]);
    if (!driversRes.ok) throw new Error(`drivers ${driversRes.status}`);
    const rows = (await driversRes.json()) as { document?: RestDocument }[];
    const drivers = rows.filter(r => r.document).map(r => decodeDriver(r.document!));
    const settings = decodeSettings(settingsRes.ok ? ((await settingsRes.json()) as RestDocument) : null);
    return { drivers, settings };
  },

  createMessage: (apiKey, params) =>
    new Anthropic({ apiKey, maxRetries: 2, timeout: 50_000 }).beta.messages.create(params),
};

class ReportError extends Error {
  constructor(public code: ReportErrorCode, public status: number, public retryAfter?: string | null) {
    super(code);
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const fail = (code: ReportErrorCode, status: number, headers: Record<string, string> = {}) =>
  json(status, { error: code, message: REPORT_ERRORS[code] }, headers);

interface ParsedRequest {
  stage: number;
  format: ReportFormat;
  notes: string;
  eventName: string | null;
  hashtags: boolean;
}

function parseBody(body: unknown): ParsedRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const stage = Number(b.stage);
  if (!Number.isInteger(stage) || stage < 1 || stage > 12) return null;
  if (typeof b.format !== 'string' || !(b.format in REPORT_FORMATS)) return null;
  const notes = typeof b.notes === 'string' ? b.notes : '';
  if (notes.length > MAX_NOTES_LENGTH) return null;
  const eventName = typeof b.eventName === 'string' ? b.eventName.trim() : '';
  if (eventName.length > MAX_EVENT_NAME_LENGTH) return null;
  return { stage, format: b.format as ReportFormat, notes, eventName: eventName || null, hashtags: b.hashtags !== false };
}

const draftText = (message: Anthropic.Beta.BetaMessage) =>
  message.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('').trim();

async function callClaude(deps: Deps, apiKey: string, messages: Anthropic.Beta.BetaMessageParam[]) {
  // Server-side refusal fallback: if a safety classifier declines, another model
  // retries inside the same call. Not available for Haiku models.
  const fallback = REPORT_MODEL.startsWith('claude-haiku')
    ? {}
    : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
  try {
    const message = await deps.createMessage(apiKey, {
      model: REPORT_MODEL,
      max_tokens: 4000,
      output_config: { effort: 'medium' },
      system: SYSTEM_PROMPT,
      messages,
      ...fallback,
    });
    if (message.stop_reason === 'refusal') throw new ReportError('AI_REFUSED', 502);
    if (message.stop_reason === 'max_tokens') throw new ReportError('AI_INCOMPLETE', 502);
    const text = draftText(message);
    if (!text) throw new ReportError('AI_INCOMPLETE', 502);
    return { message, text };
  } catch (err) {
    if (err instanceof ReportError) throw err;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new ReportError('INVALID_API_KEY', 502);
    if (err instanceof Anthropic.RateLimitError) throw new ReportError('RATE_LIMITED', 429, err.headers?.get?.('retry-after') ?? null);
    if (err instanceof Anthropic.APIConnectionError) throw new ReportError('AI_UNREACHABLE', 504);
    if (err instanceof Anthropic.InternalServerError) throw new ReportError('AI_BUSY', 503);
    if (err instanceof Anthropic.APIError && (err.status === 529 || (err.status ?? 0) >= 500)) throw new ReportError('AI_BUSY', 503);
    throw err;
  }
}

export async function handleStageReport(request: Request, deps: Deps = defaultDeps): Promise<Response> {
  try {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405, { Allow: 'POST' });

    // 1. Signed-in operator only (protects the API bill).
    const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const email = token ? await deps.verifyUser(token) : null;
    if (!token || !email) return fail('UNAUTHENTICATED', 401);
    if (!(await deps.isOperator(email, token))) return fail('NOT_OPERATOR', 403);

    // 2. Server must be configured.
    const apiKey = deps.apiKey();
    if (!apiKey) return fail('NO_API_KEY', 503);

    // 3. Validate the request.
    const parsed = parseBody(await request.json().catch(() => null));
    if (!parsed) return fail('BAD_REQUEST', 400);

    // 4. Facts come from the database, computed in code.
    let data: { drivers: Driver[]; settings: Settings };
    try {
      data = await deps.loadData();
    } catch {
      return fail('DATA_UNAVAILABLE', 502);
    }
    if (!stageHasResults(data.drivers, parsed.stage)) return fail('NO_RESULTS', 422);
    const sheet = buildFactSheet(data.drivers, data.settings, parsed.stage, parsed.eventName ?? data.settings.eventName);

    // 5. Write, check every number, regenerate once with the mismatches if needed.
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: 'user', content: buildUserMessage(sheet, { format: parsed.format, notes: parsed.notes, hashtags: parsed.hashtags }) },
    ];
    let { message, text } = await callClaude(deps, apiKey, messages);
    let check = verifyDraft(text, sheet);
    let attempts = 1;
    if (!check.ok) {
      messages.push({ role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
      messages.push({ role: 'user', content: buildCorrectionMessage(check.issues as DraftIssue[]) });
      ({ message, text } = await callClaude(deps, apiKey, messages));
      check = verifyDraft(text, sheet);
      attempts = 2;
    }

    const body: ReportResponse = {
      draft: text,
      verified: check.ok,
      checked: check.checked,
      issues: check.issues,
      attempts,
      provisional: sheet.provisional,
      stageLabel: sheet.stage.label,
      model: message.model,
    };
    return json(200, body);
  } catch (err) {
    if (err instanceof ReportError) {
      return fail(err.code, err.status, err.retryAfter ? { 'Retry-After': err.retryAfter } : {});
    }
    console.error('stage-report failed', err);
    return fail('INTERNAL', 500);
  }
}
