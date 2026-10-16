import { describe, expect, it } from 'vitest';
import drivers from './fixtures/drivers.firestore.json';
import settingsDoc from './fixtures/settings.firestore.json';
import { decodeDriver, decodeSettings } from '../src/lib/firestoreRest';
import { computeResults, ALL_STAGES } from '../src/lib/standings';
import { originalCalc } from './reference/originalCalc';

const realDrivers = drivers.map(decodeDriver);
const realSettings = decodeSettings(settingsDoc);

describe('results calculation moved to lib/standings', () => {
  it('matches the original board calculation exactly on real event data', () => {
    const before = originalCalc(realDrivers, realSettings);
    const after = computeResults(realDrivers, realSettings, ALL_STAGES);
    expect(after.classes).toEqual(before.classes);
    expect(after.classStats).toEqual(before.classStats);
    expect(after.overallStats).toEqual(before.overallStats);
    expect(after.processed).toEqual(before.processedDrivers);
  });

  it('also matches with overall DNF substitution and a different DNF penalty', () => {
    const s = { dnfPenalty: 60, dnfCalculationMethod: 'overall' as const };
    expect(computeResults(realDrivers, s).processed).toEqual(originalCalc(realDrivers, s).processedDrivers);
  });

  it('fixture really contains DNFs, penalties and several classes', () => {
    const times = realDrivers.flatMap(d => Object.values(d.stageTimes));
    expect(times.some(t => t < 0)).toBe(true);
    expect(realDrivers.some(d => Object.values(d.stagePenalties).some(p => p > 0))).toBe(true);
    expect(new Set(realDrivers.map(d => d.class)).size).toBeGreaterThan(1);
  });
});
