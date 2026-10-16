import { describe, expect, it } from 'vitest';
import type { Driver, Settings } from '../src/types';
import { buildFactSheet, stageHasResults } from '../src/lib/factSheet';
import { computeResults } from '../src/lib/standings';
import { secondsToTime } from '../src/lib/rallyUtils';
import drivers from './fixtures/drivers.firestore.json';
import settingsDoc from './fixtures/settings.firestore.json';
import { decodeDriver, decodeSettings } from '../src/lib/firestoreRest';

const settings: Settings = { dnfPenalty: 60, dnfCalculationMethod: 'class' };

// times/penalties are per stage in order (SS1, SS2, ...); undefined = no result yet.
function mk(car: string, name: string, cls: string, times: (number | undefined)[], pens: number[] = [], isHidden = false): Driver {
  const stageTimes: Record<string, number> = {};
  const stagePenalties: Record<string, number> = {};
  times.forEach((t, i) => { if (t !== undefined) { stageTimes[String(i + 1)] = t; stagePenalties[String(i + 1)] = pens[i] ?? 0; } });
  return { id: `driver_${car}_${cls}`, name, carNumber: car, class: cls, stageTimes, stagePenalties, totalTimeSeconds: 0, isHidden, updatedAt: null };
}

const cls = (sheet: ReturnType<typeof buildFactSheet>, name: string) => sheet.classes.find(c => c.name === name)!;

describe('fact sheet: normal stage', () => {
  const field = [
    mk('1', 'ALPHA', 'A', [100, 110]),
    mk('2', 'BRAVO', 'A', [101, 105]),
    mk('3', 'CHARLIE', 'A', [102, 120]),
  ];
  const sheet = buildFactSheet(field, settings, 2, 'Test Rally');
  const a = cls(sheet, 'A');

  it('ranks the stage with board-formatted times and gaps', () => {
    expect(a.stageResults.map(r => [r.position, r.car, r.stageTime, r.gapToStageWinner])).toEqual([
      [1, '2', '01:45.00', '+00:00.00'],
      [2, '1', '01:50.00', '+00:05.00'],
      [3, '3', '02:00.00', '+00:15.00'],
    ]);
  });

  it('gives cumulative standings with gaps and position changes', () => {
    expect(a.standings.map(s => [s.position, s.car, s.totalTime, s.gapToLeader, s.previousPosition, s.positionChange])).toEqual([
      [1, '2', '03:26.00', '+00:00.00', 2, 1],
      [2, '1', '03:30.00', '+00:04.00', 1, -1],
      [3, '3', '03:42.00', '+00:16.00', 3, 0],
    ]);
  });

  it('includes event, stage label and is not provisional when everyone has a time', () => {
    expect(sheet.event.name).toBe('Test Rally');
    expect(sheet.stage).toEqual({ number: 2, label: 'SS2' });
    expect(sheet.provisional).toBe(false);
  });

  it('detects the stage winner and first stage win', () => {
    expect(a.storylines).toContainEqual({ type: 'stage_winner', cars: ['2'], crews: ['BRAVO'], time: '01:45.00', tied: false, marginToNext: '+00:05.00' });
    expect(a.storylines).toContainEqual({ type: 'first_stage_win', car: '2', crew: 'BRAVO' });
  });
});

describe('fact sheet: lead change', () => {
  const field = [
    mk('1', 'ALPHA', 'A', [100, 110]),
    mk('2', 'BRAVO', 'A', [101, 105]),
    mk('3', 'CHARLIE', 'A', [102, 120]),
  ];
  const a = cls(buildFactSheet(field, settings, 2), 'A');

  it('reports the new and previous leader with the gap', () => {
    expect(a.storylines).toContainEqual({
      type: 'lead_change',
      newLeader: { car: '2', crew: 'BRAVO' },
      previousLeader: { car: '1', crew: 'ALPHA' },
      gapToSecond: '+00:04.00',
    });
  });

  it('reports biggest gain and loss', () => {
    expect(a.storylines).toContainEqual({ type: 'biggest_gain', places: 1, crews: [{ car: '2', crew: 'BRAVO', from: 2, to: 1 }] });
    expect(a.storylines).toContainEqual({ type: 'biggest_loss', places: 1, crews: [{ car: '1', crew: 'ALPHA', from: 1, to: 2 }] });
  });

  it('reports a leader extending the lead when there is no change', () => {
    const ext = cls(buildFactSheet([mk('1', 'ALPHA', 'A', [100, 100]), mk('2', 'BRAVO', 'A', [101, 103])], settings, 2), 'A');
    expect(ext.storylines).toContainEqual({ type: 'lead_extended', leader: { car: '1', crew: 'ALPHA' }, previousGapToSecond: '+00:01.00', gapToSecond: '+00:04.00' });
  });
});

describe('fact sheet: ties', () => {
  const field = [
    mk('4', 'DELTA', 'A', [100]),
    mk('5', 'ECHO', 'A', [100]),
    mk('6', 'FOXTROT', 'A', [101.5]),
  ];
  const a = cls(buildFactSheet(field, settings, 1), 'A');

  it('gives tied crews the same position and the next crew the following rank', () => {
    expect(a.stageResults.map(r => [r.position, r.tied, r.car])).toEqual([[1, true, '4'], [1, true, '5'], [3, false, '6']]);
    expect(a.standings.map(s => [s.position, s.tied])).toEqual([[1, true], [1, true], [3, false]]);
  });

  it('marks a shared stage win and a shared lead', () => {
    expect(a.storylines).toContainEqual({ type: 'stage_winner', cars: ['4', '5'], crews: ['DELTA', 'ECHO'], time: '01:40.00', tied: true, marginToNext: '+00:01.50' });
    expect(a.storylines).toContainEqual({ type: 'shared_lead', cars: ['4', '5'], crews: ['DELTA', 'ECHO'] });
  });

  it('treats times that display the same as tied (floating point noise)', () => {
    const b = cls(buildFactSheet([mk('1', 'X', 'B', [100.1 + 0.2]), mk('2', 'Y', 'B', [100.3])], settings, 1), 'B');
    expect(b.stageResults.every(r => r.position === 1 && r.tied)).toBe(true);
  });
});

describe('fact sheet: penalties', () => {
  const field = [
    mk('7', 'GOLF', 'A', [100], [10]),
    mk('8', 'HOTEL', 'A', [105]),
  ];
  const a = cls(buildFactSheet(field, settings, 1), 'A');

  it('includes the penalty in the stage time and ranking, like the board', () => {
    expect(a.stageResults.map(r => [r.position, r.car, r.stageTime, r.penaltySeconds])).toEqual([
      [1, '8', '01:45.00', 0],
      [2, '7', '01:50.00', 10],
    ]);
    expect(a.storylines).toContainEqual({ type: 'penalty', car: '7', crew: 'GOLF', penaltySeconds: 10 });
  });
});

describe('fact sheet: DNF and DNS', () => {
  const field = [
    mk('1', 'ALPHA', 'A', [100, 110]),
    mk('2', 'BRAVO', 'A', [101, 120]),
    mk('9', 'INDIA', 'A', [103, -1]),
    mk('10', 'JULIET', 'A', [104, -2]),
  ];
  const a = cls(buildFactSheet(field, settings, 2), 'A');

  it('lists DNF/DNS unranked on the stage with the substituted classified time', () => {
    const dnf = a.stageResults.find(r => r.car === '9')!;
    expect(dnf).toMatchObject({ position: null, status: 'DNF', stageTime: null, classifiedTime: '03:00.00' }); // slowest 120 + 60
    expect(a.stageResults.find(r => r.car === '10')).toMatchObject({ position: null, status: 'DNS', classifiedTime: '03:00.00' });
  });

  it('keeps DNF crews classified in the standings and flags the DNF', () => {
    const s = a.standings.find(x => x.car === '9')!;
    expect(s.totalTime).toBe(secondsToTime(103 + 180));
    expect(s.dnfDnsCount).toBe(1);
    expect(a.storylines).toContainEqual({ type: 'dnf', car: '9', crew: 'INDIA', classifiedTime: '03:00.00' });
    expect(a.storylines).toContainEqual({ type: 'dns', car: '10', crew: 'JULIET', classifiedTime: '03:00.00' });
  });
});

describe('fact sheet: missing times', () => {
  const field = [
    mk('1', 'ALPHA', 'A', [100, 110]),
    mk('2', 'BRAVO', 'A', [101, undefined]),
    mk('3', 'CHARLIE', 'A', [102, 108], [], true), // DSQ
  ];
  const sheet = buildFactSheet(field, settings, 2);
  const a = cls(sheet, 'A');

  it('lists crews still awaiting a result and marks the sheet provisional', () => {
    expect(a.awaitingResult).toEqual([{ car: '2', crew: 'BRAVO' }]);
    expect(sheet.provisional).toBe(true);
  });

  it('does not rank crews without a result for the stage', () => {
    expect(a.standings.map(s => s.car)).toEqual(['1']);
    expect(a.stageResults.map(r => r.car)).toEqual(['1']);
  });

  it('excludes disqualified crews from results and lists them separately', () => {
    expect(sheet.overall.standings.some(s => s.car === '3')).toBe(false);
    expect(sheet.disqualified).toEqual([{ car: '3', crew: 'CHARLIE', class: 'A' }]);
  });

  it('knows when a stage has no results at all', () => {
    expect(stageHasResults(field, 2)).toBe(true);
    expect(stageHasResults(field, 3)).toBe(false);
  });
});

describe('fact sheet on real event data', () => {
  const real = drivers.map(decodeDriver);
  const realSettings = decodeSettings(settingsDoc);

  it('totals for the latest stage match what the board shows', () => {
    const sheet = buildFactSheet(real, realSettings, 8);
    const board = computeResults(real, realSettings).processed;
    for (const c of sheet.classes) {
      for (const s of c.standings) {
        const d = board.find(b => b.carNumber === s.car && b.class.trim().toUpperCase() === c.name)!;
        expect(s.totalTime).toBe(secondsToTime(d.effectiveTotal));
      }
    }
  });

  it('produces the six storyline kinds where the data has them', () => {
    const sheet = buildFactSheet(real, realSettings, 8);
    const kinds = new Set(sheet.classes.flatMap(c => c.storylines.map(s => s.type)));
    expect(kinds.has('stage_winner')).toBe(true);
    expect(kinds.has('closest_gap')).toBe(true);
  });
});
