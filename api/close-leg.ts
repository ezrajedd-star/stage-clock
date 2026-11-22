/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Vercel Function: POST /api/close-leg → publishes the closed leg to PARX Open.
// Logic lives in src/server/closeLeg.ts. Needs PARX_GITHUB_TOKEN in the Vercel project's environment variables.
import { handleCloseLeg } from '../src/server/closeLeg.js';

export function POST(request: Request): Promise<Response> {
  return handleCloseLeg(request);
}
