/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared by the browser (report panel) and the server (api/stage-report).

// Writers the operator can choose in the report panel. Each is a Claude model plus an effort level
// (how hard the model thinks before writing). Swap models here, e.g. 'claude-haiku-5-5' to lower cost.
export const REPORT_WRITERS = {
  standard: {
    label: 'Standard',
    model: 'claude-sonnet-5-5',
    effort: 'high',
    description: 'Fast (10–30s) · about US$0.03–0.05 per report',
  },
  premium: {
    label: 'Premium',
    model: 'claude-opus-5-5',
    effort: 'high',
    description: 'Best writing · slower (up to about a minute) · about US$0.08–0.20 per report',
  },
} as const;

export type ReportWriter = keyof typeof REPORT_WRITERS;

// Default writer.
export const REPORT_MODEL = REPORT_WRITERS.standard.model;

// Must match the admin email in firestore.rules.
export const ADMIN_EMAIL = 'ezrajedd@gmail.com';

// Firebase identifiers the server needs (same values as firebase-applet-config.json;
// a test keeps them in sync). Public by design.
export const FIREBASE_PROJECT_ID = 'gen-lang-client-0279774038';
export const FIRESTORE_DATABASE_ID = 'ai-studio-908e4f64-e003-435a-80ae-32d2f71bac07';
export const FIREBASE_WEB_API_KEY = 'AIzaSyDHDKy6w4_kdL07eB9eN8xp2rdFhNLFjxU';

// Report formats. Add a new format here (and its instructions) to extend the writer.
// `instructions` is for a single-stage report, `rallyInstructions` for a whole-rally report.
export const REPORT_FORMATS = {
  summary: {
    label: 'Stage summary',
    rallyLabel: 'Rally report',
    instructions:
      'Write a WRC.com-style STAGE REPORT for the event website and Facebook, 150 to 250 words (hard limit 250: cut the least important class first), plain text.\n' +
      'Line 1: the headline, WRC style: present tense, at most 14 words, built as "<Name> <strong verb> <what> as <second storyline>" ' +
      '(the pattern of "X snatches the lead as Y keeps title hopes alive" or "X takes <gap> lead into <next stage>"). No colon, no emoji, no question.\n' +
      'Then short paragraphs (one to three sentences each): the lead story with its key gap (don\'t repeat the headline\'s wording); the fight for the lead and the closest battle; ' +
      'notable moves and any DNF or DNS further back; then the other classes in at most two paragraphs, each class opened differently ' +
      '(never "In <CLASS>, ..." for every class) and classes without a story left out. End on the last real story, not on a standings line. ' +
      'No emoji, no hashtags, no exclamation marks.',
    rallyInstructions:
      'Write a WRC.com-style RALLY REPORT covering every stage so far, for the event website and Facebook, 250 to 400 words (hard limit 400), plain text.\n' +
      'Line 1: the headline, WRC style: present tense, at most 14 words, about where the rally stands now and the story that got it there. No colon, no emoji, no question.\n' +
      'Then short paragraphs (one to three sentences each): first where the overall fight stands now (leader and gap, from "overall.standingsNow"); ' +
      'then how it developed, in stage order, told through its turning points only (lead changes, a run of stage wins, a retirement that changed the order, the biggest climb) — never a stage-by-stage list; ' +
      'then the classes in at most three paragraphs, each opened differently, built on each class\'s own storylines (who led for how long, stage-win tally, the closest gap now). ' +
      'End on what is at stake next or the tightest fight still open, not on a standings line. No emoji, no hashtags, no exclamation marks.',
  },
  social: {
    label: 'Social post',
    rallyLabel: 'Rally recap post',
    instructions:
      'Write a SOCIAL POST in the voice of the WRC social channels, 40 to 90 words.\n' +
      'Line 1: the result in a short, punchy line that leads with the name and the key gap (for example the shape "<Name> takes <stage> by <gap>"). No generic opener such as "SS8 done!".\n' +
      'Then 2 to 4 short lines, one fact per line, the most interesting first (the lead and its gap, a close fight, a first stage win, other class winners in one line). ' +
      'At most 2 emoji in the whole post, only where they add something (🏁 ⏱️), never at the start of every line, never as labels. At most one exclamation mark.',
    rallyInstructions:
      'Write a SOCIAL RECAP POST of the rally so far, in the voice of the WRC social channels, 60 to 120 words.\n' +
      'Line 1: where the rally stands, leading with the leader\'s name and the gap. No generic opener.\n' +
      'Then 3 to 5 short lines, one story per line, the biggest first (how the lead was won or kept, a run of stage wins, the biggest climb, the tightest fight now, class leaders in one line). ' +
      'At most 2 emoji in the whole post, only where they add something (🏁 ⏱️), never at the start of every line, never as labels. At most one exclamation mark.',
  },
} as const;

// What a report covers: one stage, or the whole rally from SS1 up to the chosen stage.
export const REPORT_SCOPES = {
  stage: { label: 'One stage', description: 'The chosen stage only' },
  rally: { label: 'Whole rally', description: 'Every stage from SS1 up to the chosen stage · Premium recommended' },
} as const;

export type ReportScope = keyof typeof REPORT_SCOPES;

export type ReportFormat = keyof typeof REPORT_FORMATS;

export const MAX_NOTES_LENGTH = 1000;
export const MAX_EVENT_NAME_LENGTH = 120;

// Error codes the endpoint returns, with the message shown to the operator.
export const REPORT_ERRORS = {
  METHOD_NOT_ALLOWED: 'Use POST.',
  UNAUTHENTICATED: 'Please sign in again, then retry.',
  NOT_OPERATOR: 'Only timing operators can generate reports.',
  BAD_REQUEST: 'The request was incomplete. Refresh the page and try again.',
  NO_API_KEY: 'The report writer is not set up yet: ANTHROPIC_API_KEY is missing on the server (Vercel → Settings → Environment Variables).',
  INVALID_API_KEY: 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel, and that the account has credit.',
  RATE_LIMITED: 'Too many requests to the AI right now. Wait a minute and try again.',
  AI_BUSY: 'The AI service is busy. Try again in a moment.',
  AI_UNREACHABLE: 'Could not reach the AI service (network problem). Try again.',
  AI_REFUSED: 'The AI declined to write this report. Try again, or adjust the notes.',
  AI_INCOMPLETE: 'The AI stopped before finishing. Try again.',
  DATA_UNAVAILABLE: 'Could not load the results from the database. Try again.',
  NO_RESULTS: 'This stage has no results yet, so there is nothing to report.',
  INTERNAL: 'Something went wrong while writing the report. Try again.',
} as const;

export type ReportErrorCode = keyof typeof REPORT_ERRORS;

export interface ReportIssue {
  kind: string;
  text: string;
  start: number;
  end: number;
  message: string;
}

export interface ReportResponse {
  draft: string;
  writer: ReportWriter;      // which writer produced it
  scope: ReportScope;        // one stage or the whole rally
  verified: boolean;         // every checked number matched the fact sheet
  checked: number;           // how many numbers / pairings were checked
  issues: ReportIssue[];     // non-empty only when verified is false
  attempts: number;          // 1, or 2 if it was regenerated after a failed check
  provisional: boolean;      // some crews had no result for the stage yet
  stageLabel: string;        // "SS8", or "SS1–SS8" for a whole-rally report
  model: string;
}
