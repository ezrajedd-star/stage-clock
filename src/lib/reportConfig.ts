/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared by the browser (report panel) and the server (api/stage-report).

// Claude model for the Stage Report Writer. Swap for e.g. 'claude-haiku-5-5' to lower cost.
export const REPORT_MODEL = 'claude-sonnet-5-5';

// Must match the admin email in firestore.rules.
export const ADMIN_EMAIL = 'ezrajedd@gmail.com';

// Firebase identifiers the server needs (same values as firebase-applet-config.json;
// a test keeps them in sync). Public by design.
export const FIREBASE_PROJECT_ID = 'gen-lang-client-0279774038';
export const FIRESTORE_DATABASE_ID = 'ai-studio-908e4f64-e003-435a-80ae-32d2f71bac07';
export const FIREBASE_WEB_API_KEY = 'AIzaSyDHDKy6w4_kdL07eB9eN8xp2rdFhNLFjxU';

// Report formats. Add a new format here (and its instructions) to extend the writer.
export const REPORT_FORMATS = {
  summary: {
    label: 'Stage summary',
    instructions:
      'Write a STAGE SUMMARY: 120 to 220 words in 2 to 4 short paragraphs of plain text. ' +
      'Cover the stage winner in each class, any lead change (or the leader extending or losing ground), and the closest battle. ' +
      'You may mention the fastest time overall if the overall section supports it. No emoji, no hashtags, no headings.',
  },
  social: {
    label: 'Social post',
    instructions:
      'Write a SOCIAL POST for Facebook and Instagram: punchy, 50 to 120 words, short lines. ' +
      'Lead with the headline result, then one or two more highlights. A few emoji are fine.',
  },
} as const;

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
  verified: boolean;         // every checked number matched the fact sheet
  checked: number;           // how many numbers / pairings were checked
  issues: ReportIssue[];     // non-empty only when verified is false
  attempts: number;          // 1, or 2 if it was regenerated after a failed check
  provisional: boolean;      // some crews had no result for the stage yet
  stageLabel: string;
  model: string;
}
