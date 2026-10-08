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

2. Create your local environment file and fill in the values:

   ```sh
   cp .env.example .env.local
   ```

3. Start the dev server:

   ```sh
   npm run dev
   ```

   The app runs at http://localhost:3000.

## Environment variables

All variables go in `.env.local`, which git ignores. `.env.example` lists them without values.

| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase web app ID |
| `VITE_FIREBASE_MEASUREMENT_ID` | Analytics measurement ID (may be empty) |
| `VITE_FIREBASE_FIRESTORE_DATABASE_ID` | Named Firestore database the app reads and writes |
| `GEMINI_API_KEY` | Optional. The AI Studio template wires it into the build, but the app doesn't use it |

You'll find the values in Firebase console → Project settings → Your apps → Web app config. Firebase web config is bundled into the browser build by design. Access is controlled by `firestore.rules` and Firebase Auth, not by keeping the key secret.

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
firestore.rules            deployed Firestore security rules
DRAFT_firestore.rules      earlier draft of the rules (not deployed)
firebase-blueprint.json    data model description (AI Studio)
security_spec.md           security notes (AI Studio)
metadata.json              app metadata (AI Studio)
```
