/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseClock, type FactSheet } from './factSheet.js';
import type { RallySheet } from './rallySheet.js';

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
const MIN_SEC = /(?<![\d:.])\+?(\d{1,2})\s?min\s?(\d{1,2}(?:\.\d{1,2})?)\s?(?:s|secs?|seconds?)\b/gi; // "1min 26.14sec"
const SECONDS = /(?<![\d:.])\+?(\d{1,3}(?:\.\d{1,2})?)\s?(?:s|secs?|seconds?)\b/gi;
const CAR = /#(\d{1,4})\b|\bcar\s+#?(\d{1,4})\b/gi;
const ORDINAL = /\b(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:stage|stages|ss|win|wins|time|times|consecutive|straight|career|round|event|rally|day|km|kilomet))/gi;
const P_POS = /\bP(\d{1,2})\b/g;
// Positions written as words, WRC style: "fourth overall", "second in class", "third place", "second-fastest".
const WORD_NUMBERS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
const WORD_POS = new RegExp(`\\b(${WORD_NUMBERS.join('|')})(?=[\\s-]+(?:place|overall|position|in (?:the )?(?:class|group|standings|order)|on the stage|fastest|quickest|best)\\b)`, 'gi');
const PLACES = /\b(\d{1,2})\s+(?:places?|positions?|spots?)\b/gi;

const toCs = (seconds: number) => Math.round(seconds * 100);

function collectFacts(sheet: FactSheet | RallySheet) {
  const cars = new Map<string, CarFacts>();
  const timesCs = new Set<number>();
  const secondsValues = new Set<number>(); // penalties and the DNF penalty, in centiseconds

  const car = (n: string) => {
    if (!cars.has(n)) cars.set(n, { crews: new Set(), positions: new Set(), placeChanges: new Set() });
    return cars.get(n)!;
  };
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  // Walk the whole sheet (single-stage or whole-rally):
  // - every clock-formatted string is an allowed time/gap;
  // - every { car, crew } object registers the crew, and its positions
  //   (position, previousPosition, from/to) and position changes for that car.
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      const m = v.match(/^\+?((?:\d{1,2}:)?\d{1,2}:\d{2}\.\d{2}|\d{1,2}\.\d{2})$/);
      if (m) timesCs.add(toCs(parseClock(m[1])));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.car === 'string' && typeof o.crew === 'string') {
        const c = car(o.car);
        c.crews.add(o.crew.toLowerCase());
        for (const k of ['position', 'previousPosition', 'from', 'to']) if (isNum(o[k])) c.positions.add(o[k] as number);
        if (isNum(o.positionChange)) c.placeChanges.add(Math.abs(o.positionChange));
        if (isNum(o.from) && isNum(o.to)) c.placeChanges.add(Math.abs(o.from - o.to));
        if (isNum(o.penaltySeconds) && o.penaltySeconds > 0) secondsValues.add(toCs(o.penaltySeconds));
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(sheet);
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

export function verifyDraft(draft: string, sheet: FactSheet | RallySheet): VerifyResult {
  const facts = collectFacts(sheet);
  const original = draft;
  // Car models ("Turbo 1NZ Corolla", "K20 RWD Beetle") are not numbers to check: blank them
  // out (same length, so positions in the text stay the same).
  const vehicles = [...new Set(sheet.crews.map(c => c.vehicle).filter((v): v is string => !!v))].sort((a, b) => b.length - a.length);
  for (const v of vehicles) {
    draft = draft.replace(new RegExp(`(?<![\\p{L}\\d])${escapeRe(v)}(?![\\p{L}\\d])`, 'giu'), m => ' '.repeat(m.length));
  }
  const issues: DraftIssue[] = [];
  let checked = 0;
  const add = (kind: IssueKind, start: number, end: number, message: string) =>
    issues.push({ kind, text: original.slice(start, end), start, end, message });

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
  for (const m of draft.matchAll(MIN_SEC)) {
    const s = m.index!, e = s + m[0].length;
    if (masked.some(([a, b]) => s < b && e > a)) continue;
    masked.push([s, e]);
    checked++;
    const cs = toCs(Number(m[1]) * 60 + Number(m[2]));
    if (!facts.timesCs.has(cs)) add('time', s, e, `${m[0].trim()} does not match any time or gap in the results.`);
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
  for (const m of draft.matchAll(WORD_POS)) checkPosition(WORD_NUMBERS.indexOf(m[1].toLowerCase()) + 1, m.index!, m.index! + m[0].length);
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
