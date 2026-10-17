/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Vercel Function: POST /api/stage-report → drafts a stage report with Claude.
// Logic lives in src/server/stageReport.ts. Needs ANTHROPIC_API_KEY in the
// Vercel project's environment variables (never in the browser bundle).
import { handleStageReport } from '../src/server/stageReport.js';

export function POST(request: Request): Promise<Response> {
  return handleStageReport(request);
}
