/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Driver, Settings } from '../types';
import {
  buildFactSheet, crewRoster, stageHasResults, parseClock,
  type CrewInfo, type StandingEntry, type Storyline, type FactSheet,
} from './factSheet.js';

// Fact sheet for a whole-rally report (SS1 up to a chosen stage). Built from the
// per-stage fact sheets, so every number is the same one the board and the
// single-stage report use. The AI only writes prose.

type Crew = { car: string; crew: string };

export interface StageSummary {
  stage: string;                                  // "SS3"
  fastestOverall: { cars: string[]; crews: string[]; classes: string[]; time: string; marginToNext: string | null } | null;
  overallLeaderAfter: { car: string; crew: string; gapToSecond: string | null; leadChanged: boolean } | null;
  classes: {
    class: string;
    stageWinner: { cars: string[]; crews: string[]; time: string; tied: boolean; marginToNext: string | null } | null;
    leaderAfter: { car: string; crew: string; gapToSecond: string | null; leadChanged: boolean } | null;
  }[];
  retirements: { car: string; crew: string; class: string; status: 'DNF' | 'DNS' }[];
  penalties: { car: string; crew: string; class: string; penaltySeconds: number }[];
}

export type RallyStoryline =
  // Stage wins so far, most first (crews with at least one win).
  | { type: 'stage_win_tally'; crews: { car: string; crew: string; wins: number; stages: string[] }[] }
  // Who led after each stage, as spells; leadChanges = number of times the lead changed hands.
  | { type: 'lead_history'; spells: { car: string; crew: string; fromStage: string; toStage: string; stages: number }[]; leadChanges: number }
  // Most places gained/lost between a crew's first classified stage and now.
  | { type: 'biggest_climb' | 'biggest_drop'; places: number; crews: { car: string; crew: string; from: number; to: number; sinceStage: string }[] }
  // Closest gap between neighbours in the top 5 now.
  | { type: 'closest_gap_now'; ahead: Crew & { position: number }; behind: Crew & { position: number }; gap: string }
  // Crews with at least one DNF/DNS so far.
  | { type: 'retirements_so_far'; crews: { car: string; crew: string; stages: string[] }[] };

export interface RallyScope {
  name: string;                     // class name or "OVERALL"
  standingsNow: StandingEntry[];    // after the last stage covered (previousPosition = after the stage before)
  storylines: RallyStoryline[];
}

export interface RallyHeadline {
  scope: string;
  story: RallyStoryline | Storyline;
}

export interface RallySheet {
  kind: 'rally';
  event: { name: string | null };
  covers: { from: string; to: string; stages: string[]; label: string };
  provisional: boolean;             // the last stage still has crews without a time
  dnfRule: string;
  overall: RallyScope;
  classes: RallyScope[];
  stageByStage: StageSummary[];
  headlines: RallyHeadline[];
  crews: CrewInfo[];
  disqualified: FactSheet['disqualified'];
  formatNotes: string;
}

const who = (e: Crew) => ({ car: e.car, crew: e.crew });
const same = (a: Crew, b: Crew) => a.car === b.car && a.crew === b.crew;
const secs = (gap: string | null) => (gap ? parseClock(gap.replace('+', '')) : Infinity);

function leaderOf(standings: StandingEntry[], previousLeader: Crew | null) {
  const leaders = standings.filter(s => s.position === 1);
  if (leaders.length !== 1) return null;
  const second = standings.find(s => s.position > 1);
  return { ...who(leaders[0]), gapToSecond: second?.gapToLeader ?? null, leadChanged: !!previousLeader && !same(previousLeader, leaders[0]) };
}

function stageWinnerOf(story: Storyline | undefined) {
  if (!story || story.type !== 'stage_winner') return null;
  return { cars: story.cars, crews: story.crews, time: story.time, tied: story.tied, marginToNext: story.marginToNext };
}

// Storylines for one scope (a class or overall) across the stages covered.
function rallyStorylines(name: string, perStage: { label: string; sheet: FactSheet }[]): RallyStoryline[] {
  const out: RallyStoryline[] = [];
  const scopeOf = (sheet: FactSheet) => (name === 'OVERALL' ? sheet.overall : sheet.classes.find(c => c.name === name));

  // Stage wins.
  const wins = new Map<string, { car: string; crew: string; wins: number; stages: string[] }>();
  for (const { label, sheet } of perStage) {
    const scope = scopeOf(sheet);
    for (const r of scope?.stageResults.filter(r => r.position === 1) ?? []) {
      const key = `${r.car}|${r.crew}`;
      const entry = wins.get(key) ?? { ...who(r), wins: 0, stages: [] };
      entry.wins++;
      entry.stages.push(label);
      wins.set(key, entry);
    }
  }
  if (wins.size) out.push({ type: 'stage_win_tally', crews: [...wins.values()].sort((a, b) => b.wins - a.wins) });

  // Lead history as spells.
  const spells: { car: string; crew: string; fromStage: string; toStage: string; stages: number }[] = [];
  for (const { label, sheet } of perStage) {
    const leaders = scopeOf(sheet)?.standings.filter(s => s.position === 1) ?? [];
    if (leaders.length !== 1) continue; // shared lead: no single leader
    const last = spells[spells.length - 1];
    if (last && same(last, leaders[0])) {
      last.toStage = label;
      last.stages++;
    } else {
      spells.push({ ...who(leaders[0]), fromStage: label, toStage: label, stages: 1 });
    }
  }
  if (spells.length) out.push({ type: 'lead_history', spells, leadChanges: spells.length - 1 });

  // Biggest climb / drop since each crew's first classified stage.
  const latest = scopeOf(perStage[perStage.length - 1].sheet);
  if (latest && perStage.length > 1) {
    const moves: { car: string; crew: string; from: number; to: number; sinceStage: string; change: number }[] = [];
    for (const now of latest.standings) {
      for (const { label, sheet } of perStage.slice(0, -1)) {
        const first = scopeOf(sheet)?.standings.find(s => same(s, now));
        if (first) {
          moves.push({ ...who(now), from: first.position, to: now.position, sinceStage: label, change: first.position - now.position });
          break;
        }
      }
    }
    const up = Math.max(0, ...moves.map(m => m.change));
    const down = Math.min(0, ...moves.map(m => m.change));
    const strip = ({ change: _c, ...m }: typeof moves[number]) => m;
    if (up >= 2) out.push({ type: 'biggest_climb', places: up, crews: moves.filter(m => m.change === up).map(strip) });
    if (down <= -2) out.push({ type: 'biggest_drop', places: -down, crews: moves.filter(m => m.change === down).map(strip) });

    const closest = latest.storylines.find((s): s is Extract<Storyline, { type: 'closest_gap' }> => s.type === 'closest_gap');
    if (closest) out.push({ type: 'closest_gap_now', ahead: closest.ahead, behind: closest.behind, gap: closest.gap });
  }

  // Retirements so far.
  const retired = new Map<string, { car: string; crew: string; stages: string[] }>();
  for (const { label, sheet } of perStage) {
    for (const r of scopeOf(sheet)?.stageResults.filter(r => r.status !== 'TIME') ?? []) {
      const key = `${r.car}|${r.crew}`;
      const entry = retired.get(key) ?? { ...who(r), stages: [] };
      entry.stages.push(label);
      retired.set(key, entry);
    }
  }
  if (retired.size) out.push({ type: 'retirements_so_far', crews: [...retired.values()] });

  return out;
}

// Orders the stories a reporter would lead a rally report with. Fixed rules, no AI judgment.
function rankRallyHeadlines(overall: RallyScope, classes: RallyScope[]): RallyHeadline[] {
  const scored: { score: number; headline: RallyHeadline }[] = [];
  const add = (scope: string, story: RallyStoryline, score: number) => scored.push({ score, headline: { scope, story } });
  for (const scope of [overall, ...classes]) {
    const isOverall = scope === overall;
    for (const story of scope.storylines) {
      if (story.type === 'lead_history') add(scope.name, story, (isOverall ? 100 : 80) + Math.min(story.leadChanges, 5));
      if (story.type === 'stage_win_tally' && story.crews[0].wins >= 2) add(scope.name, story, isOverall ? 90 : 60);
      if (story.type === 'closest_gap_now') add(scope.name, story, secs(story.gap) < 5 ? (isOverall ? 85 : 70) : 40);
      if (story.type === 'biggest_climb' && story.places >= 3) add(scope.name, story, isOverall ? 65 : 45);
      if (story.type === 'biggest_drop' && story.places >= 3) add(scope.name, story, isOverall ? 55 : 35);
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 10).map(s => s.headline);
}

export function buildRallySheet(drivers: Driver[], settings: Settings, upToStage: number, eventName?: string | null): RallySheet {
  if (!Number.isInteger(upToStage) || upToStage < 1 || upToStage > 12) throw new Error(`Invalid stage ${upToStage}`);

  const perStage = Array.from({ length: upToStage }, (_, i) => i + 1)
    .filter(n => stageHasResults(drivers, n))
    .map(n => ({ label: `SS${n}`, sheet: buildFactSheet(drivers, settings, n, eventName) }));
  if (!perStage.length) throw new Error('No results to report');
  const last = perStage[perStage.length - 1].sheet;

  const stageByStage: StageSummary[] = [];
  let prevOverall: Crew | null = null;
  const prevClass = new Map<string, Crew | null>();
  for (const { label, sheet } of perStage) {
    const fastest = sheet.eventStorylines.find(s => s.type === 'fastest_overall');
    const overallLeader = leaderOf(sheet.overall.standings, prevOverall);
    stageByStage.push({
      stage: label,
      fastestOverall: fastest && fastest.type === 'fastest_overall'
        ? { cars: fastest.cars, crews: fastest.crews, classes: fastest.classes, time: fastest.time, marginToNext: fastest.marginToNext }
        : null,
      overallLeaderAfter: overallLeader,
      classes: sheet.classes.map(c => {
        const leader = leaderOf(c.standings, prevClass.get(c.name) ?? null);
        if (leader) prevClass.set(c.name, leader);
        return { class: c.name, stageWinner: stageWinnerOf(c.storylines.find(s => s.type === 'stage_winner')), leaderAfter: leader };
      }),
      retirements: sheet.overall.stageResults
        .filter(r => r.status !== 'TIME')
        .map(r => ({ ...who(r), class: r.class, status: r.status as 'DNF' | 'DNS' })),
      penalties: sheet.overall.stageResults
        .filter(r => r.penaltySeconds > 0)
        .map(r => ({ ...who(r), class: r.class, penaltySeconds: r.penaltySeconds })),
    });
    if (overallLeader) prevOverall = overallLeader;
  }

  const overall: RallyScope = { name: 'OVERALL', standingsNow: last.overall.standings, storylines: rallyStorylines('OVERALL', perStage) };
  const classes: RallyScope[] = last.classes.map(c => ({ name: c.name, standingsNow: c.standings, storylines: rallyStorylines(c.name, perStage) }));
  const stages = perStage.map(p => p.label);

  return {
    kind: 'rally',
    event: last.event,
    covers: { from: stages[0], to: stages[stages.length - 1], stages, label: stages.length > 1 ? `${stages[0]}–${stages[stages.length - 1]}` : stages[0] },
    provisional: last.provisional,
    dnfRule: last.dnfRule,
    overall,
    classes,
    stageByStage,
    headlines: rankRallyHeadlines(overall, classes),
    crews: crewRoster(drivers),
    disqualified: last.disqualified,
    formatNotes: last.formatNotes + ' "standingsNow" is after the last stage covered; "previousPosition" there is after the stage before it. Stage-by-stage leaders and winners are per stage.',
  };
}
