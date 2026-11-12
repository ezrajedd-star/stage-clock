import { describe, expect, it } from 'vitest';
import drivers from './fixtures/drivers.firestore.json';
import settingsDoc from './fixtures/settings.firestore.json';
import { decodeDriver, decodeSettings } from '../src/lib/firestoreRest';
import { computeResults, ALL_STAGES, type ProcessedDriver } from '../src/lib/standings';
import { calculateTotalTime } from '../src/lib/rallyUtils';
import { originalCalc } from './reference/originalCalc';
import type { Driver, Settings } from '../src/types';

const realDrivers = drivers.map(decodeDriver);
const realSettings = decodeSettings(settingsDoc);

// Without disqualified rows, the shared calculation must match the original board exactly.
const officialDrivers = realDrivers.filter(d => !d.isHidden);
// The original calculation had no dropped runs; with none dropped the rest must match exactly.
const withoutDrops = (rows: ProcessedDriver[]) => rows.map(({ isDropped, ...rest }) => {
  expect(isDropped).toEqual({});
  return rest;
});

describe('results calculation moved to lib/standings', () => {
  it('matches the original board calculation exactly on real event data', () => {
    const before = originalCalc(officialDrivers, realSettings);
    const after = computeResults(officialDrivers, realSettings, ALL_STAGES);
    expect(after.classes).toEqual(before.classes);
    expect(after.classStats).toEqual(before.classStats);
    expect(after.overallStats).toEqual(before.overallStats);
    expect(withoutDrops(after.processed)).toEqual(before.processedDrivers);
  });

  it('also matches with overall DNF substitution and a different DNF penalty', () => {
    const s = { dnfPenalty: 60, dnfCalculationMethod: 'overall' as const };
    expect(withoutDrops(computeResults(officialDrivers, s).processed)).toEqual(originalCalc(officialDrivers, s).processedDrivers);
  });

  it('fixture contains disqualified rows with times', () => {
    expect(realDrivers.some(d => d.isHidden && Object.values(d.stageTimes).some(t => t > 0))).toBe(true);
  });
});

describe('DNF/DNS substitute time uses official entries only', () => {
  const mk = (id: string, cls: string, t: number, hidden = false): Driver => ({
    id, name: id, carNumber: id, class: cls, stageTimes: { '1': t }, stagePenalties: {}, totalTimeSeconds: 0, isHidden: hidden, updatedAt: null,
  });
  const field = [mk('1', 'A', 100), mk('2', 'A', 110), mk('3', 'A', 500, true), mk('4', 'A', -1), mk('5', 'B', 90), mk('6', 'B', 900, true)];
  const dnfTime = (s: Settings) => computeResults(field, s, [1]).processed.find(d => d.id === '4')!.effectiveStageTimes['1'];

  it('ignores a disqualified slower time in the class', () => {
    expect(dnfTime({ dnfPenalty: 5, dnfCalculationMethod: 'class' })).toBe(115);
  });

  it('ignores disqualified times overall too', () => {
    expect(dnfTime({ dnfPenalty: 5, dnfCalculationMethod: 'overall' })).toBe(115);
  });

  it('gives the same result as if the disqualified rows were not there', () => {
    const s = { dnfPenalty: 5, dnfCalculationMethod: 'class' as const };
    const withDsq = computeResults(realDrivers, s).processed.filter(d => !d.isHidden);
    expect(withDsq).toEqual(computeResults(officialDrivers, s).processed);
  });
});

describe('dropped runs', () => {
  const mk = (id: string, times: number[], dropped?: string[]): Driver => ({
    id, name: id, carNumber: id, class: 'A', totalTimeSeconds: 0, updatedAt: null, droppedStages: dropped,
    stageTimes: Object.fromEntries(times.map((t, i) => [String(i + 1), t])), stagePenalties: { '2': 10 },
  });
  const s: Settings = { dnfPenalty: 5, dnfCalculationMethod: 'class' };

  it('leave the run (and its penalty) out of that crew\'s total but keep it on the stage', () => {
    const [a] = computeResults([mk('1', [100, 200, 110], ['2']), mk('2', [101, 102, 103])], s, [1, 2, 3]).processed;
    expect(a.effectiveTotal).toBe(210);
    expect(a.effectiveStageTimes['2']).toBe(210);
    expect(a.isDropped).toEqual({ '2': true });
  });

  it('do not change anyone else\'s times, including DNF substitutes', () => {
    const field = [mk('1', [100, 200], ['2']), mk('2', [101, 102]), mk('3', [102, -1])];
    const before = computeResults(field.map(d => ({ ...d, droppedStages: undefined })), s, [1, 2]).processed;
    const after = computeResults(field, s, [1, 2]).processed;
    expect(after.slice(1).map(d => d.effectiveTotal)).toEqual(before.slice(1).map(d => d.effectiveTotal));
    expect(after[2].effectiveStageTimes['2']).toBe(215); // slowest in class 210 (incl. penalty) + 5
  });

  it('can drop a DNF/DNS so its substitute time is not added', () => {
    const [, , c] = computeResults([mk('1', [100, 200]), mk('2', [101, 102]), mk('3', [102, -1], ['2'])], s, [1, 2]).processed;
    expect(c.effectiveTotal).toBe(102);
  });

  it('are left out of the stored total too', () => {
    expect(calculateTotalTime({ '1': 100, '2': 200 }, { '2': 10 }, ['2'])).toBe(100);
    expect(calculateTotalTime({ '1': 100, '2': 200 }, { '2': 10 })).toBe(310);
  });
});

describe('fixture', () => {

  it('fixture really contains DNFs, penalties and several classes', () => {
    const times = realDrivers.flatMap(d => Object.values(d.stageTimes));
    expect(times.some(t => t < 0)).toBe(true);
    expect(realDrivers.some(d => Object.values(d.stagePenalties).some(p => p > 0))).toBe(true);
    expect(new Set(realDrivers.map(d => d.class)).size).toBeGreaterThan(1);
  });
});
