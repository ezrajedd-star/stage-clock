/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Driver, Settings } from '../types';
import { computeResults, classKey, type ProcessedDriver } from './standings.js';
import { secondsToTime } from './rallyUtils.js';

// Fact sheet for the Stage Report Writer. Everything a report may state is
// computed here, in code, from the same calculation the results board uses.
// Times are formatted exactly as the board shows them. The AI only writes prose.

export type ResultStatus = 'TIME' | 'DNF' | 'DNS';

export interface StageResultEntry {
  position: number | null;     // null for DNF/DNS (not ranked on the stage)
  tied: boolean;               // shares this position with another crew
  car: string;
  crew: string;
  class: string;
  status: ResultStatus;
  stageTime: string | null;    // incl. penalty, as on the board, e.g. "02:08.69"
  penaltySeconds: number;
  gapToStageWinner: string | null; // e.g. "+00:01.23"; "+00:00.00" for the winner
  classifiedTime: string | null;   // DNF/DNS only: substituted time counted in the total
}

export interface StandingEntry {
  position: number;
  tied: boolean;
  car: string;
  crew: string;
  class: string;
  totalTime: string;           // cumulative after this stage, as on the board
  gapToLeader: string;         // "+00:00.00" for the leader
  previousPosition: number | null; // after the previous stage, if classified then
  positionChange: number | null;   // + = places gained, - = places lost
  stagesWithResult: number;
  dnfDnsCount: number;
}

export type Storyline =
  | { type: 'stage_winner'; cars: string[]; crews: string[]; time: string; tied: boolean; marginToNext: string | null; stageWinsThisEvent: number[] }
  | { type: 'first_stage_win'; car: string; crew: string }
  | { type: 'lead_change'; newLeader: { car: string; crew: string }; previousLeader: { car: string; crew: string }; gapToSecond: string | null }
  | { type: 'lead_extended' | 'lead_reduced' | 'lead_unchanged'; leader: { car: string; crew: string }; second: { car: string; crew: string }; previousGapToSecond: string; gapToSecond: string; change: string }
  | { type: 'leader_after_first_stage'; leader: { car: string; crew: string } }
  | { type: 'shared_lead'; cars: string[]; crews: string[] }
  | { type: 'closest_gap'; ahead: { car: string; crew: string; position: number }; behind: { car: string; crew: string; position: number }; gap: string }
  | { type: 'biggest_gain' | 'biggest_loss'; places: number; crews: { car: string; crew: string; from: number; to: number }[] }
  | { type: 'dnf' | 'dns'; car: string; crew: string; classifiedTime: string | null }
  | { type: 'penalty'; car: string; crew: string; penaltySeconds: number }
  // Event-wide (across classes), computed in code so the writer never compares classes itself.
  | { type: 'fastest_overall'; cars: string[]; crews: string[]; classes: string[]; time: string; tied: boolean; marginToNext: string | null }
  | { type: 'closest_class_battle'; class: string; ahead: { car: string; crew: string; position: number }; behind: { car: string; crew: string; position: number }; gap: string };

export interface Headline {
  scope: string;     // class name, "OVERALL" or "EVENT"
  story: Storyline;
}

export interface ScopeSheet {
  scope: 'class' | 'overall';
  name: string;                // class name, or "OVERALL"
  stageResults: StageResultEntry[];
  standings: StandingEntry[];
  awaitingResult: { car: string; crew: string }[]; // no result entered for this stage yet
  storylines: Storyline[];
}

export interface FactSheet {
  event: { name: string | null };
  stage: { number: number; label: string };
  provisional: boolean;        // true while some crews have no result for this stage
  dnfRule: string;
  classes: ScopeSheet[];
  overall: ScopeSheet;
  eventStorylines: Storyline[];
  headlines: Headline[];     // most newsworthy first, chosen by fixed rules
  disqualified: { car: string; crew: string; class: string }[];
  formatNotes: string;
}

// Names entered all in lowercase are shown in title case ("ting tong" -> "Ting Tong");
// short vowel-less words are initials ("vm" -> "VM"). Names with capitals are kept as entered.
export function displayName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name !== name.toLowerCase()) return name;
  return name.split(' ').map(w => (w.length <= 3 && !/[aeiouy]/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
const crewOf = (d: Driver) => displayName(d.name);
const hasResult = (d: Driver, stage: number) => d.stageTimes[String(stage)] !== undefined;

// Same formatting as the board.
const fmtStage = (seconds: number) => secondsToTime(seconds).replace(/^00:/, '');
const fmtTotal = (seconds: number) => secondsToTime(seconds);
const fmtGap = (seconds: number) => `+${secondsToTime(seconds)}`;

// Competition ranking (1, 1, 3) on the displayed value: equal display = tie.
function rank<T>(items: T[], seconds: (t: T) => number, display: (t: T) => string, tiebreak: (t: T) => string) {
  const sorted = [...items].sort((a, b) => seconds(a) - seconds(b) || tiebreak(a).localeCompare(tiebreak(b), undefined, { numeric: true }));
  return sorted.map((item) => {
    const shown = display(item);
    const position = 1 + sorted.filter(o => seconds(o) < seconds(item) && display(o) !== shown).length;
    const tied = sorted.filter(o => display(o) === shown).length > 1;
    return { item, position, tied };
  });
}

function stageResultsFor(group: ProcessedDriver[], stage: number): StageResultEntry[] {
  const key = String(stage);
  const withTime = group.filter(d => d.stageTimes[key] > 0);
  const ranked = rank(withTime, d => d.effectiveStageTimes[key], d => fmtStage(d.effectiveStageTimes[key]), d => d.carNumber);
  const winnerSeconds = ranked.length ? ranked[0].item.effectiveStageTimes[key] : 0;

  const timed: StageResultEntry[] = ranked.map(({ item: d, position, tied }) => ({
    position,
    tied,
    car: d.carNumber,
    crew: crewOf(d),
    class: d.class,
    status: 'TIME',
    stageTime: fmtStage(d.effectiveStageTimes[key]),
    penaltySeconds: d.stagePenalties[key] || 0,
    gapToStageWinner: fmtGap(d.effectiveStageTimes[key] - winnerSeconds),
    classifiedTime: null,
  }));

  const notTimed: StageResultEntry[] = group
    .filter(d => d.stageTimes[key] < 0)
    .sort((a, b) => a.carNumber.localeCompare(b.carNumber, undefined, { numeric: true }))
    .map(d => ({
      position: null,
      tied: false,
      car: d.carNumber,
      crew: crewOf(d),
      class: d.class,
      status: d.stageTimes[key] === -1 ? 'DNF' : 'DNS',
      stageTime: null,
      penaltySeconds: d.stagePenalties[key] || 0,
      gapToStageWinner: null,
      classifiedTime: d.effectiveStageTimes[key] > 0 ? fmtStage(d.effectiveStageTimes[key]) : null,
    }));

  return [...timed, ...notTimed];
}

function standingsFor(group: ProcessedDriver[], stage: number, previous: Map<string, number> | null): StandingEntry[] {
  const classified = group.filter(d => hasResult(d, stage));
  const ranked = rank(classified, d => d.effectiveTotal, d => fmtTotal(d.effectiveTotal), d => d.carNumber);
  const leaderTotal = ranked.length ? ranked[0].item.effectiveTotal : 0;

  return ranked.map(({ item: d, position, tied }) => {
    const prev = previous?.get(d.id) ?? null;
    const stageKeys = Object.keys(d.stageTimes).filter(k => Number(k) <= stage);
    return {
      position,
      tied,
      car: d.carNumber,
      crew: crewOf(d),
      class: d.class,
      totalTime: fmtTotal(d.effectiveTotal),
      gapToLeader: fmtGap(d.effectiveTotal - leaderTotal),
      previousPosition: prev,
      positionChange: prev === null ? null : prev - position,
      stagesWithResult: stageKeys.length,
      dnfDnsCount: stageKeys.filter(k => d.stageTimes[k] < 0).length,
    };
  });
}

function storylinesFor(
  stage: number,
  results: StageResultEntry[],
  standings: StandingEntry[],
  previousStandings: StandingEntry[] | null,
  earlierWins: Map<string, number>,
): Storyline[] {
  const out: Storyline[] = [];
  const who = (e: { car: string; crew: string }) => ({ car: e.car, crew: e.crew });

  // Stage winner(s) and margin to the next crew.
  const winners = results.filter(r => r.position === 1);
  if (winners.length) {
    const next = results.find(r => r.position !== null && r.position > 1);
    out.push({
      type: 'stage_winner',
      cars: winners.map(w => w.car),
      crews: winners.map(w => w.crew),
      time: winners[0].stageTime as string,
      tied: winners.length > 1,
      marginToNext: next ? next.gapToStageWinner : null,
      stageWinsThisEvent: winners.map(w => (earlierWins.get(w.car + '|' + w.crew) ?? 0) + 1),
    });
    if (stage > 1) {
      for (const w of winners) {
        if (!earlierWins.has(w.car + '|' + w.crew)) out.push({ type: 'first_stage_win', ...who(w) });
      }
    }
  }

  // Lead change / leader extending or reducing the lead.
  const leaders = standings.filter(s => s.position === 1);
  if (leaders.length > 1) {
    out.push({ type: 'shared_lead', cars: leaders.map(l => l.car), crews: leaders.map(l => l.crew) });
  } else if (leaders.length === 1) {
    const leader = leaders[0];
    const second = standings.find(s => s.position > 1) ?? null;
    const prevLeader = previousStandings?.find(s => s.position === 1) ?? null;
    if (!previousStandings || !prevLeader) {
      out.push({ type: 'leader_after_first_stage', leader: who(leader) });
    } else if (prevLeader.car !== leader.car || prevLeader.crew !== leader.crew) {
      out.push({ type: 'lead_change', newLeader: who(leader), previousLeader: who(prevLeader), gapToSecond: second?.gapToLeader ?? null });
    } else {
      const prevSecond = previousStandings.find(s => s.position > 1);
      if (second && prevSecond) {
        const now = second.gapToLeader;
        const before = prevSecond.gapToLeader;
        const toCs = (g: string) => Math.round(parseClock(g.replace('+', '')) * 100);
        const type = toCs(now) > toCs(before) ? 'lead_extended' : toCs(now) < toCs(before) ? 'lead_reduced' : 'lead_unchanged';
        out.push({ type, leader: who(leader), second: who(second), previousGapToSecond: before, gapToSecond: now, change: fmtGap(Math.abs(toCs(now) - toCs(before)) / 100) });
      }
    }
  }

  // Closest gap between neighbours in the top 5.
  const top = standings.filter(s => s.position <= 5);
  let closest: Storyline | null = null;
  let best = Infinity;
  for (let i = 1; i < top.length; i++) {
    const gap = parseClock(top[i].gapToLeader.replace('+', '')) - parseClock(top[i - 1].gapToLeader.replace('+', ''));
    const cs = Math.round(gap * 100);
    if (cs < best) {
      best = cs;
      closest = {
        type: 'closest_gap',
        ahead: { ...who(top[i - 1]), position: top[i - 1].position },
        behind: { ...who(top[i]), position: top[i].position },
        gap: fmtGap(cs / 100),
      };
    }
  }
  if (closest) out.push(closest);

  // Biggest gain and loss in position.
  const moved = standings.filter(s => s.positionChange !== null && s.positionChange !== 0);
  const maxGain = Math.max(0, ...moved.map(s => s.positionChange as number));
  const maxLoss = Math.min(0, ...moved.map(s => s.positionChange as number));
  if (maxGain > 0) {
    out.push({ type: 'biggest_gain', places: maxGain, crews: moved.filter(s => s.positionChange === maxGain).map(s => ({ ...who(s), from: s.previousPosition as number, to: s.position })) });
  }
  if (maxLoss < 0) {
    out.push({ type: 'biggest_loss', places: -maxLoss, crews: moved.filter(s => s.positionChange === maxLoss).map(s => ({ ...who(s), from: s.previousPosition as number, to: s.position })) });
  }

  // Retirements / non-starters and penalties on this stage.
  for (const r of results) {
    if (r.status === 'DNF') out.push({ type: 'dnf', ...who(r), classifiedTime: r.classifiedTime });
    if (r.status === 'DNS') out.push({ type: 'dns', ...who(r), classifiedTime: r.classifiedTime });
    if (r.penaltySeconds > 0) out.push({ type: 'penalty', ...who(r), penaltySeconds: r.penaltySeconds });
  }

  return out;
}

// Parses the board's display formats back to seconds ("MM:SS.SS", "H:MM:SS.SS", "SS.SS").
export function parseClock(text: string): number {
  const parts = text.trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function buildScope(
  scope: 'class' | 'overall',
  name: string,
  all: Driver[],
  settings: Settings,
  stage: number,
  inScope: (d: Driver) => boolean,
): ScopeSheet {
  const stagesUpTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  // Stats use every entry (incl. DSQ), exactly like the board; rankings exclude DSQ.
  const current = computeResults(all, settings, stagesUpTo(stage)).processed.filter(d => !d.isHidden && inScope(d));
  const stageResults = stageResultsFor(current, stage);

  let previousStandings: StandingEntry[] | null = null;
  let previousMap: Map<string, number> | null = null;
  const earlierWins = new Map<string, number>();
  if (stage > 1) {
    const prevProcessed = computeResults(all, settings, stagesUpTo(stage - 1)).processed.filter(d => !d.isHidden && inScope(d));
    previousStandings = standingsFor(prevProcessed, stage - 1, null);
    previousMap = new Map();
    for (const s of previousStandings) {
      const d = prevProcessed.find(p => p.carNumber === s.car && crewOf(p) === s.crew && p.class === s.class);
      if (d) previousMap.set(d.id, s.position);
    }
    for (let k = 1; k < stage; k++) {
      const earlier = computeResults(all, settings, stagesUpTo(k)).processed.filter(d => !d.isHidden && inScope(d));
      stageResultsFor(earlier, k).filter(r => r.position === 1).forEach(r => earlierWins.set(r.car + '|' + r.crew, (earlierWins.get(r.car + '|' + r.crew) ?? 0) + 1));
    }
  }

  const standings = standingsFor(current, stage, previousMap);
  const awaitingResult = current
    .filter(d => !hasResult(d, stage) && Object.keys(d.stageTimes).some(k => Number(k) < stage))
    .map(d => ({ car: d.carNumber, crew: crewOf(d) }));

  return {
    scope,
    name,
    stageResults,
    standings,
    awaitingResult,
    storylines: storylinesFor(stage, stageResults, standings, previousStandings, earlierWins),
  };
}

function buildEventStorylines(classes: ScopeSheet[], overall: ScopeSheet): Storyline[] {
  const out: Storyline[] = [];
  const winners = overall.stageResults.filter(r => r.position === 1);
  if (winners.length) {
    const next = overall.stageResults.find(r => r.position !== null && r.position > 1);
    out.push({
      type: 'fastest_overall',
      cars: winners.map(w => w.car), crews: winners.map(w => w.crew), classes: winners.map(w => w.class),
      time: winners[0].stageTime as string, tied: winners.length > 1, marginToNext: next ? next.gapToStageWinner : null,
    });
  }
  // Closest fight between neighbours in any class's top 5 (ties between classes: first alphabetically).
  let best: { cls: string; story: Extract<Storyline, { type: 'closest_gap' }> } | null = null;
  for (const c of classes) {
    const story = c.storylines.find((s): s is Extract<Storyline, { type: 'closest_gap' }> => s.type === 'closest_gap');
    if (story && (!best || parseClock(story.gap.slice(1)) < parseClock(best.story.gap.slice(1)))) best = { cls: c.name, story };
  }
  if (best && classes.length > 1) {
    out.push({ type: 'closest_class_battle', class: best.cls, ahead: best.story.ahead, behind: best.story.behind, gap: best.story.gap });
  }
  return out;
}

// Orders the stories a reporter would lead with. Fixed rules, no AI judgment.
function rankHeadlines(classes: ScopeSheet[], overall: ScopeSheet, eventStorylines: Storyline[]): Headline[] {
  const scored: { score: number; headline: Headline }[] = [];
  const add = (scope: string, story: Storyline, score: number) => scored.push({ score, headline: { scope, story } });
  const secs = (gap: string | null) => (gap ? parseClock(gap.replace('+', '')) : Infinity);

  for (const story of overall.storylines) {
    if (story.type === 'lead_change') add('OVERALL', story, 100);
    if (story.type === 'shared_lead') add('OVERALL', story, 95);
    if ((story.type === 'lead_extended' || story.type === 'lead_reduced') && secs(story.change) >= 1) add('OVERALL', story, 60);
    if (story.type === 'biggest_gain' && story.places >= 2) add('OVERALL', story, 40);
  }
  for (const story of eventStorylines) {
    if (story.type === 'fastest_overall') add('EVENT', story, story.tied || secs(story.marginToNext) < 1 ? 85 : 80);
    if (story.type === 'closest_class_battle') add('EVENT', story, secs(story.gap) < 2 ? 70 : 50);
  }
  for (const c of classes) {
    const prev = new Map(c.standings.map(s => [s.car, s.previousPosition]));
    for (const story of c.storylines) {
      if (story.type === 'lead_change') add(c.name, story, 90);
      if (story.type === 'shared_lead') add(c.name, story, 88);
      if (story.type === 'stage_winner') add(c.name, story, story.tied ? 78 : secs(story.marginToNext) < 1 ? 74 : 45);
      if (story.type === 'first_stage_win') add(c.name, story, 72);
      if ((story.type === 'dnf' || story.type === 'dns') && (prev.get(story.car) ?? 99) <= 3) add(c.name, story, 65);
      if ((story.type === 'lead_extended' || story.type === 'lead_reduced') && secs(story.change) >= 5) add(c.name, story, 55);
      if (story.type === 'biggest_gain' && story.places >= 2) add(c.name, story, 35);
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 8).map(s => s.headline);
}

export function buildFactSheet(drivers: Driver[], settings: Settings, stage: number, eventName?: string | null): FactSheet {
  if (!Number.isInteger(stage) || stage < 1 || stage > 12) throw new Error(`Invalid stage ${stage}`);

  const classNames = Array.from(new Set(drivers.filter(d => !d.isHidden).map(classKey))).sort();
  const classes = classNames
    .map(cls => buildScope('class', cls, drivers, settings, stage, d => classKey(d) === cls))
    .filter(s => s.stageResults.length > 0 || s.awaitingResult.length > 0);
  const overall = buildScope('overall', 'OVERALL', drivers, settings, stage, () => true);

  const eventStorylines = buildEventStorylines(classes, overall);
  const method = settings.dnfCalculationMethod === 'overall' ? 'slowest time on the stage overall' : 'slowest time on the stage in their class';
  return {
    event: { name: eventName?.trim() || null },
    stage: { number: stage, label: `SS${stage}` },
    provisional: overall.awaitingResult.length > 0,
    dnfRule: `Crews with a DNF or DNS on a stage stay classified: they are given the ${method} plus ${settings.dnfPenalty}s (the classifiedTime).`,
    classes,
    overall,
    eventStorylines,
    headlines: rankHeadlines(classes, overall, eventStorylines),
    disqualified: drivers.filter(d => d.isHidden).map(d => ({ car: d.carNumber, crew: crewOf(d), class: d.class })),
    formatNotes: 'Stage times are M:SS.ss as shown on the results board (leading "00:" dropped). Totals and gaps are MM:SS.ss (H:MM:SS.ss over an hour). Gaps start with "+". Positions are ranked within the class (classes) or across all classes (overall). Tied crews share a position.',
  };
}

// True when the stage has at least one result (time, DNF or DNS) in any class.
export function stageHasResults(drivers: Driver[], stage: number): boolean {
  return drivers.some(d => !d.isHidden && hasResult(d, stage));
}
