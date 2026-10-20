# Stage Clock

Stage Clock is a rally timing and results app for events of up to 12 special stages. Timing operators sign in with Google and use the input terminal to enter each car's stage time (MM:SS.SS or H:MM:SS.SS), penalties, DNF/DNS results and the car each crew drives (CAR column; "Save car" updates it without entering a time). The results board updates live for every viewer. It shows stage times grouped by class with the fastest and slowest highlighted, and a leaderboard (by class or overall) with gaps to the leader. DNF/DNS results are replaced with the slowest time in the class (or overall) plus a configurable penalty; only official entries count, so disqualified (hidden) rows never set that slowest time. Operators can disqualify (hide/show) entries, export the results to CSV, and draft stage reports with the Stage Report Writer. Data is stored in Cloud Firestore, and the app can be installed as a PWA.

Originally built in Google AI Studio.

## Prerequisites

- Node.js 20 or later (tested with Node 22) and npm
- Access to the Firebase project that holds the Stage Clock data, or your own Firebase project with Firestore and Google sign-in enabled

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Optional, for the Stage Report Writer: create `.env.local` (git-ignored) from `.env.example` and set `ANTHROPIC_API_KEY`.

3. Start the dev server:

   ```sh
   npm run dev
   ```

   The app runs at http://localhost:3000. The dev server also serves `/api/stage-report`.

## Deployment

The site is hosted on Vercel at https://stage-clock-rho.vercel.app/. Every push to `main` on GitHub rebuilds and redeploys it automatically; other branches get preview deployments.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Vercel → Project → Settings → Environment Variables (all environments); `.env.local` for local dev | Claude API key for the Stage Report Writer. Read only by the server function, never sent to the browser. Never commit a real key. |

## Stage Report Writer

Operators get a **Report** button in the results toolbar. Choose what the report covers (**One stage**, or the **Whole rally** from SS1 up to the chosen stage), the format (summary or social post), optionally add notes (for example "car 7 puncture at km 4"), and generate. The draft can be edited, copied and regenerated.

How accuracy is protected:

1. **Fact sheet in code** (`src/lib/factSheet.ts`): stage results, class and overall standings, gaps, position changes, ties, penalties, DNF/DNS, crews still awaiting a time, and rule-based storylines are computed from the same calculation the board uses (`src/lib/standings.ts`), with times formatted exactly as the board shows them, plus each crew's car. Whole-rally reports use `src/lib/rallySheet.ts`, built from the per-stage fact sheets: stage-by-stage winners, leaders and retirements, lead history, stage-win tallies, biggest climbs and current standings.
2. **Claude writes the prose** (`api/stage-report.ts` → `src/server/stageReport.ts`) from the fact sheet and the operator's notes only. The operator picks a **Writer**: **Standard** (`claude-sonnet-5-5`, fast, a few US cents per report) or **Premium** (`claude-opus-5-5`, the strongest writer, slower and a few times the cost). Writers are defined in `REPORT_WRITERS` in `src/lib/reportConfig.ts`; the choice is remembered on each device. `vercel.json` allows the function up to 300 seconds so a Premium report plus its one correction pass can finish. The system prompt is in `src/lib/reportPrompt.ts`.
3. **Number check** (`src/lib/verifyDraft.ts`): every time, gap, penalty, position, place count and car number in the draft is checked against the fact sheet, and crew names must sit next to their own car number. On a mismatch the server regenerates once with the list of problems. If it still fails, the panel shows the draft as **Not verified** with the problem items highlighted. Edits are re-checked live.

The endpoint only answers signed-in operators (the admin or emails in `operators`), reads the results from Firestore itself, and returns clear errors for a missing or invalid key, rate limits, network failures and stages without results. New formats can be added in `REPORT_FORMATS` (`src/lib/reportConfig.ts`).

## Firebase configuration

The app connects to Firebase using `firebase-applet-config.json` (project `gen-lang-client-0279774038`, Firestore database `ai-studio-908e4f64-…`). This web config is meant to be public: it ships in every visitor's browser. Who can change data is controlled by `firestore.rules`:

- Anyone can read results.
- Only the admin (ezrajedd@gmail.com) and timing staff listed in the `operators` collection can write. Each staff member is a document whose ID is their Google email in lowercase.

Changes to `firestore.rules` take effect only after they are published in the Firebase console (Firestore → Rules → Publish).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Type-check with `tsc --noEmit` |
| `npm test` | Unit tests (Vitest): results calculation, fact sheet, number check, report endpoint |
| `npm run clean` | Delete `dist/` |

## Project layout

```
index.html                 entry HTML
vite.config.ts             Vite + React + Tailwind + PWA config
src/main.tsx               React entry
src/App.tsx                layout, auth, Firestore listeners, write logic
src/components/            InputConsole (operator form), ResultsDisplay (results board), ReportPanel (report writer)
src/lib/rallyUtils.ts      time parsing/formatting and total-time calculation
src/lib/standings.ts       results calculation shared by the board and the report writer
src/lib/factSheet.ts       stage fact sheet for reports
src/lib/verifyDraft.ts     number check for generated reports
src/lib/reportConfig.ts    report model, formats, error messages
src/lib/reportPrompt.ts    report system prompt and messages
src/server/stageReport.ts  report endpoint logic (auth, data, Claude, check)
api/stage-report.ts        Vercel Function entry for POST /api/stage-report
tests/                     Vitest tests and a snapshot of real event data
src/services/firebase.ts   Firebase init, Google sign-in, error helper
src/types.ts               data types
firestore.rules            Firestore security rules (publish in Firebase console)
DRAFT_firestore.rules      earlier draft of the rules (not deployed)
firebase-blueprint.json    data model description (AI Studio)
security_spec.md           security notes (AI Studio)
metadata.json              app metadata (AI Studio)
```
