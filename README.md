# Stage Clock

Stage Clock is a rally timing and results app for events of up to 12 special stages. Timing operators sign in with Google and use the input terminal to enter each car's stage time (MM:SS.SS or H:MM:SS.SS), penalties and DNF/DNS results. The results board updates live for every viewer. It shows stage times grouped by class with the fastest and slowest highlighted, and a per-class leaderboard with gaps to the leader. DNF/DNS results are replaced with the slowest time in the class (or overall) plus a configurable penalty. Operators can disqualify (hide/show) entries and export the results to CSV. Data is stored in Cloud Firestore, and the app can be installed as a PWA.

Originally built in Google AI Studio.

## Prerequisites

- Node.js 20 or later (tested with Node 22) and npm
- Access to the Firebase project that holds the Stage Clock data, or your own Firebase project with Firestore and Google sign-in enabled

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Start the dev server:

   ```sh
   npm run dev
   ```

   The app runs at http://localhost:3000.

## Deployment

The site is hosted on Vercel at https://stage-clock-rho.vercel.app/. Every push to `main` on GitHub rebuilds and redeploys it automatically. No environment variables are needed.

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
| `npm run clean` | Delete `dist/` |

## Project layout

```
index.html                 entry HTML
vite.config.ts             Vite + React + Tailwind + PWA config
src/main.tsx               React entry
src/App.tsx                layout, auth, Firestore listeners, write logic
src/components/            InputConsole (operator form), ResultsDisplay (results board)
src/lib/rallyUtils.ts      time parsing/formatting and total-time calculation
src/services/firebase.ts   Firebase init, Google sign-in, error helper
src/types.ts               data types
firestore.rules            Firestore security rules (publish in Firebase console)
DRAFT_firestore.rules      earlier draft of the rules (not deployed)
firebase-blueprint.json    data model description (AI Studio)
security_spec.md           security notes (AI Studio)
metadata.json              app metadata (AI Studio)
```
