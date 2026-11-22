/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// PARX Open integration, shared by the browser and the server.
// When an admin closes a leg, Stage Clock asks the PARX Open repository (GitHub) to import the
// final results; the PARX website then republishes its results and standings (about 1–2 minutes).

export const PARX_DISPATCH_EVENT = 'stage-clock-leg-closed';
export const DEFAULT_PARX_REPO = 'ezrajedd-star/PARX-Open-MVP-Website';
export const LEG_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Used when the PARX website can't be reached for its live list (/api/legs.json).
export const FALLBACK_PARX_LEGS = [
  { slug: 'ormoc', round: 1, name: 'Ormoc' },
  { slug: 'tabogon', round: 2, name: 'Tabogon' },
  { slug: 'iloilo', round: 3, name: 'Iloilo' },
  { slug: 'bacolod', round: 4, name: 'Bacolod' },
  { slug: 'bukidnon', round: 5, name: 'Bukidnon' },
];

export type ParxLeg = { slug: string; round: number; name: string; hasResults?: boolean };

export const CLOSE_LEG_ERRORS = {
  UNAUTHENTICATED: 'Sign in again to close the leg.',
  FORBIDDEN: 'Only the admin can close a leg and publish results.',
  BAD_REQUEST: 'Choose a valid PARX Open leg.',
  NOT_CONFIGURED: 'Publishing to PARX Open is not set up yet (PARX_GITHUB_TOKEN is missing on the server). The leg is closed; ask the admin to add the token, then tap “Retry publish”.',
  GITHUB_REJECTED: 'GitHub refused the publish request. Check that PARX_GITHUB_TOKEN is valid and has access to the PARX Open repository, then tap “Retry publish”.',
  NETWORK: 'Could not reach GitHub. Check the connection and tap “Retry publish”.',
} as const;
export type CloseLegErrorCode = keyof typeof CLOSE_LEG_ERRORS;
