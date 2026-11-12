import { describe, expect, it } from 'vitest';
import type { Driver, Settings } from '../src/types';
import { secondsToTime, timeToSeconds } from '../src/lib/rallyUtils';
import { buildFactSheet } from '../src/lib/factSheet';
import { verifyDraft } from '../src/lib/verifyDraft';

describe('times to the thousandth', () => {
  it('formats with three decimals', () => {
    expect(secondsToTime(125.425)).toBe('02:05.425');
    expect(secondsToTime(3725.001)).toBe('1:02:05.001');
    expect(secondsToTime(0.007)).toBe('00:00.007');
    expect(secondsToTime(0)).toBe('00:00.000');
  });

  it('never shows float noise or rounds up to 60 seconds', () => {
    expect(secondsToTime(0.1 + 0.2)).toBe('00:00.300');
    expect(secondsToTime(59.9999999)).toBe('01:00.000');
    expect(secondsToTime(125.425 + 130.456)).toBe('04:15.881');
  });

  it('reads times typed with 3, 2 or 1 decimals', () => {
    expect(timeToSeconds('02:05.425')).toBeCloseTo(125.425, 9);
    expect(timeToSeconds('02:05.42')).toBeCloseTo(125.42, 9);
    expect(timeToSeconds('1:02:05.001')).toBeCloseTo(3725.001, 9);
  });

  const settings: Settings = { dnfPenalty: 5, dnfCalculationMethod: 'class' };
  const mk = (car: string, name: string, times: number[]): Driver => ({
    id: car, name, carNumber: car, class: 'A', totalTimeSeconds: 0, updatedAt: null, stagePenalties: {},
    stageTimes: Object.fromEntries(times.map((t, i) => [String(i + 1), t])),
  });
  // Gaps that only differ in the third decimal.
  const sheet = buildFactSheet([mk('1', 'ALPHA', [100.001, 110.4]), mk('2', 'BRAVO', [100.002, 109.975])], settings, 2);

  it('keeps the third decimal in fact sheet times and gaps', () => {
    const a = sheet.classes[0];
    expect(a.stageResults.map(r => [r.car, r.stageTime, r.gapToStageWinner])).toEqual([['2', '01:49.975', '+00:00.000'], ['1', '01:50.400', '+00:00.425']]);
    expect(a.standings.map(s => [s.car, s.totalTime, s.gapToLeader])).toEqual([['2', '03:29.977', '+00:00.000'], ['1', '03:30.401', '+00:00.424']]);
  });

  it('only ranks crews as tied when all three decimals match', () => {
    const first = buildFactSheet([mk('1', 'ALPHA', [100.001]), mk('2', 'BRAVO', [100.002])], settings, 1).classes[0];
    expect(first.stageResults.map(r => [r.position, r.tied])).toEqual([[1, false], [2, false]]);
  });

  it('accepts the exact value with or without trailing zeros, and catches rounding', () => {
    expect(verifyDraft('Bravo (#2) won SS2 by 0.425sec and leads by 0.424sec.', sheet).issues).toEqual([]);
    expect(verifyDraft('Bravo (#2) won SS2 in 1min 49.975sec.', sheet).issues).toEqual([]);
    expect(verifyDraft('Bravo (#2) won SS2 in 1:50.40, from Alpha (#1).', sheet).ok).toBe(true); // Alpha's 01:50.400
    expect(verifyDraft('Bravo (#2) won SS2 by 0.43sec.', sheet).issues.map(i => i.text)).toEqual(['0.43sec']);
    expect(verifyDraft('Bravo (#2) leads by 0.42sec.', sheet).issues.map(i => i.text)).toEqual(['0.42sec']);
    expect(verifyDraft('Bravo (#2) won SS2 in 01:49.98.', sheet).issues.map(i => i.text)).toEqual(['01:49.98']);
  });
});
