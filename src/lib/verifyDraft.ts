/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseClock, type FactSheet } from './factSheet.js';

// Checks a generated report against its fact sheet before anyone sees it.
// Every time, gap, position, place count and car number in the text must
// exist in the fact sheet, and crew names must sit next to their own car.

export type IssueKind = 'time' | 'position' | 'places' | 'car' | 'crew';

export interface DraftIssue {
  kind: IssueKind;
  text: string;      // the exact text that failed
  start: number;     // index in the draft, for highlighting
  end: number;
  message: string;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;   // how many numbers / pairings were checked
  issues: DraftIssue[];
}

interface CarFacts {
  crews: Set<string>;     // lowercase
  positions: Set<number>;
  placeChanges: Set<number>;
}

const CLOCK = /(?<![\d:.])\+?(?:\d{1,2}:)?\d{1,2}:\d{2}\.\d{2}(?![\d])/g;
const SECONDS = /(?<![\d:.])\+?(\d{1,3}(?:\.\d{1,2})?)\s?(?:s|secs?|seconds?)\b/gi;
const CAR = /#(\d{1,4})\b|\bcar\s+#?(\d{1,4})\b/gi;
const ORDINAL = /\b(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:stage|stages|ss|win|wins|time|times|consecutive|straight|career|round|event|rally|day|km|kilomet))/gi;
const P_POS = /\bP(\d{1,2})\b/g;
const PLACES = /\b(\d{1,2})\s+(?:places?|positions?|spots?)\b/gi;

const toCs = (seconds: number) => Math.round(seconds * 100);

function collectFacts(sheet: FactSheet) {
  const cars = new Map<string, CarFacts>();
  const timesCs = new Set<number>();
  const secondsValues = new Set<number>(); // penalties and the DNF penalty, in centiseconds

  const car = (n: string) => {
    if (!cars.has(n)) cars.set(n, { crews: new Set(), positions: new Set(), placeChanges: new Set() });
    return cars.get(n)!;
  };

  // Every clock-formatted string anywhere in the sheet is an allowed time/gap.
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      const m = v.match(/^\+?((?:\d{1,2}:)?\d{1,2}:\d{2}\.\d{2}|\d{1,2}\.\d{2})$/);
      if (m) timesCs.add(toCs(parseClock(m[1])));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(sheet);

  for (const scope of [...sheet.classes, sheet.overall]) {
    for (const r of scope.stageResults) {
      const c = car(r.car);
      c.crews.add(r.crew.toLowerCase());
      if (r.position !== null) c.positions.add(r.position);
      if (r.penaltySeconds > 0) secondsValues.add(toCs(r.penaltySeconds));
    }
    for (const s of scope.standings) {
      const c = car(s.car);
      c.crews.add(s.crew.toLowerCase());
      c.positions.add(s.position);
      if (s.previousPosition !== null) c.positions.add(s.previousPosition);
      if (s.positionChange !== null) c.placeChanges.add(Math.abs(s.positionChange));
    }
    for (const a of scope.awaitingResult) car(a.car).crews.add(a.crew.toLowerCase());
  }
  const dnfPenalty = sheet.dnfRule.match(/plus (\d+(?:\.\d+)?)s/);
  if (dnfPenalty) secondsValues.add(toCs(Number(dnfPenalty[1])));

  // Crew name -> cars, longest names first so "VM LOCSIN" wins over "VM".
  const crewToCars = new Map<string, Set<string>>();
  for (const [n, f] of cars) for (const crew of f.crews) {
    if (!crew) continue;
    if (!crewToCars.has(crew)) crewToCars.set(crew, new Set());
    crewToCars.get(crew)!.add(n);
  }
  const crewNames = [...crewToCars.keys()].sort((a, b) => b.length - a.length);

  return { cars, timesCs, secondsValues, crewToCars, crewNames };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Sentence boundaries: ., ! or ? followed by whitespace, or a line break.
function sentenceBounds(text: string): [number, number][] {
  const bounds: [number, number][] = [];
  const re = /[.!?](?=\s)|\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    bounds.push([start, m.index + 1]);
    start = m.index + 1;
  }
  bounds.push([start, text.length]);
  return bounds;
}

export function verifyDraft(draft: string, sheet: FactSheet): VerifyResult {
  const facts = collectFacts(sheet);
  const issues: DraftIssue[] = [];
  let checked = 0;
  const add = (kind: IssueKind, start: number, end: number, message: string) =>
    issues.push({ kind, text: draft.slice(start, end), start, end, message });

  // Car and crew mentions, with positions in the text.
  const carMentions: { car: string; start: number; end: number }[] = [];
  for (const m of draft.matchAll(CAR)) {
    const n = m[1] ?? m[2];
    carMentions.push({ car: n, start: m.index!, end: m.index! + m[0].length });
    checked++;
    if (!facts.cars.has(n)) add('car', m.index!, m.index! + m[0].length, `Car ${n} is not in the results for this stage.`);
  }
  const crewMentions: { crew: string; start: number; end: number }[] = [];
  const taken: [number, number][] = [];
  for (const crew of facts.crewNames) {
    const re = new RegExp(`(?<![\\p{L}\\d])${escapeRe(crew)}(?![\\p{L}\\d])`, 'giu');
    for (const m of draft.matchAll(re)) {
      const s = m.index!, e = s + m[0].length;
      if (taken.some(([a, b]) => s < b && e > a)) continue; // part of a longer name
      taken.push([s, e]);
      crewMentions.push({ crew, start: s, end: e });
    }
  }

  // Crew must belong to the car written next to it: "#7 KIM" or "KIM (#7)".
  for (const cm of carMentions) {
    const after = crewMentions.find(c => /^\s*$/.test(draft.slice(cm.end, c.start)) && c.start >= cm.end);
    const before = crewMentions.find(c => c.end <= cm.start && /^\s*\(?\s*$/.test(draft.slice(c.end, cm.start)));
    for (const c of [after, before]) {
      if (!c) continue;
      checked++;
      const carCrews = facts.cars.get(cm.car)?.crews;
      if (carCrews && !carCrews.has(c.crew)) {
        const actual = [...carCrews].join(' / ').toUpperCase();
        add('crew', Math.min(cm.start, c.start), Math.max(cm.end, c.end), `Car ${cm.car} is ${actual}, not ${c.crew.toUpperCase()}.`);
      }
    }
  }

  // Times and gaps.
  const masked: [number, number][] = [];
  for (const m of draft.matchAll(CLOCK)) {
    const s = m.index!, e = s + m[0].length;
    masked.push([s, e]);
    checked++;
    const cs = toCs(parseClock(m[0].replace('+', '')));
    if (!facts.timesCs.has(cs)) add('time', s, e, `${m[0]} does not match any time or gap in the results.`);
  }
  for (const m of draft.matchAll(SECONDS)) {
    const s = m.index!, e = s + m[0].length;
    if (masked.some(([a, b]) => s < b && e > a)) continue;
    checked++;
    const cs = toCs(Number(m[1]));
    if (!facts.timesCs.has(cs) && !facts.secondsValues.has(cs)) add('time', s, e, `${m[0].trim()} does not match any time, gap or penalty in the results.`);
  }

  // Positions and place counts, checked against the cars named in the same sentence.
  const sentences = sentenceBounds(draft);
  const carsInSentence = (pos: number) => {
    const [a, b] = sentences.find(([s, e]) => pos >= s && pos < e) ?? [0, draft.length];
    const set = new Set<string>();
    carMentions.filter(c => c.start >= a && c.start < b).forEach(c => set.add(c.car));
    crewMentions.filter(c => c.start >= a && c.start < b).forEach(c => facts.crewToCars.get(c.crew)?.forEach(n => set.add(n)));
    return set;
  };
  const allCars = [...facts.cars.keys()];

  const checkPosition = (value: number, s: number, e: number) => {
    checked++;
    const named = carsInSentence(s);
    const pool = named.size ? [...named] : allCars;
    if (!pool.some(n => facts.cars.get(n)?.positions.has(value))) {
      const who = named.size ? `car ${[...named].join(', ')}` : 'any crew';
      add('position', s, e, `Position ${draft.slice(s, e)} does not match ${who} in the results.`);
    }
  };
  for (const m of draft.matchAll(ORDINAL)) checkPosition(Number(m[1]), m.index!, m.index! + m[0].length);
  for (const m of draft.matchAll(P_POS)) checkPosition(Number(m[1]), m.index!, m.index! + m[0].length);
  for (const m of draft.matchAll(PLACES)) {
    checked++;
    const s = m.index!, e = s + m[0].length;
    const named = carsInSentence(s);
    const pool = named.size ? [...named] : allCars;
    if (!pool.some(n => facts.cars.get(n)?.placeChanges.has(Number(m[1])))) {
      add('places', s, e, `"${m[0]}" does not match a position change in the results.`);
    }
  }

  issues.sort((a, b) => a.start - b.start);
  return { ok: issues.length === 0, checked, issues };
}
