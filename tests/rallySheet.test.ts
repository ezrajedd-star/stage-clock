import { describe, expect, it } from 'vitest';
import type { Driver, Settings } from '../src/types';
import { buildRallySheet } from '../src/lib/rallySheet';
import { verifyDraft } from '../src/lib/verifyDraft';
import drivers from './fixtures/drivers.firestore.json';
import settingsDoc from './fixtures/settings.firestore.json';
import { decodeDriver, decodeSettings } from '../src/lib/firestoreRest';

const settings: Settings = { dnfPenalty: 60, dnfCalculationMethod: 'class' };
function mk(car: string, name: string, cls: string, times: number[], carModel?: string): Driver {
  const stageTimes: Record<string, number> = {};
  times.forEach((t, i) => { stageTimes[String(i + 1)] = t; });
  return { id: `driver_${car}_${cls}`, name, carNumber: car, carModel, class: cls, stageTimes, stagePenalties: {}, totalTimeSeconds: 0, updatedAt: null };
}

// ALPHA leads after SS1, BRAVO takes over on SS2 and wins SS2 and SS3; CHARLIE retires on SS3.
const field = [
  mk('1', 'ALPHA', 'A', [100, 110, 112], 'Turbo 1NZ Corolla'),
  mk('2', 'BRAVO', 'A', [101, 104, 105]),
  mk('3', 'CHARLIE', 'A', [102, 108, -1]),
  mk('7', 'KIM', 'B', [130, 131, 129], 'K20 RWD Beetle'),
];
const sheet = buildRallySheet(field, settings, 3, 'Test Rally');
const overall = (type: string) => sheet.overall.storylines.find(s => s.type === type);

describe('rally fact sheet', () => {
  it('covers every stage with results up to the chosen one', () => {
    expect(sheet.kind).toBe('rally');
    expect(sheet.covers).toEqual({ from: 'SS1', to: 'SS3', stages: ['SS1', 'SS2', 'SS3'], label: 'SS1–SS3' });
    expect(sheet.stageByStage.map(s => s.stage)).toEqual(['SS1', 'SS2', 'SS3']);
  });

  it('tracks the lead as spells and counts lead changes', () => {
    expect(overall('lead_history')).toEqual({
      type: 'lead_history', leadChanges: 1,
      spells: [
        { car: '1', crew: 'ALPHA', fromStage: 'SS1', toStage: 'SS1', stages: 1 },
        { car: '2', crew: 'BRAVO', fromStage: 'SS2', toStage: 'SS3', stages: 2 },
      ],
    });
    expect(sheet.stageByStage[1].overallLeaderAfter).toMatchObject({ car: '2', leadChanged: true });
    expect(sheet.stageByStage[2].overallLeaderAfter).toMatchObject({ car: '2', leadChanged: false });
  });

  it('tallies stage wins per crew', () => {
    const tally = sheet.classes.find(c => c.name === 'A')!.storylines.find(s => s.type === 'stage_win_tally');
    expect(tally).toEqual({ type: 'stage_win_tally', crews: [
      { car: '2', crew: 'BRAVO', wins: 2, stages: ['SS2', 'SS3'] },
      { car: '1', crew: 'ALPHA', wins: 1, stages: ['SS1'] },
    ] });
  });

  it('lists retirements per stage and so far', () => {
    expect(sheet.stageByStage[2].retirements).toEqual([{ car: '3', crew: 'CHARLIE', class: 'A', status: 'DNF' }]);
    expect(overall('retirements_so_far')).toEqual({ type: 'retirements_so_far', crews: [{ car: '3', crew: 'CHARLIE', stages: ['SS3'] }] });
  });

  it('gives the current standings and the cars', () => {
    expect(sheet.overall.standingsNow.map(s => s.car)).toEqual(['2', '1', '3', '7']);
    expect(sheet.crews.find(c => c.car === '7')).toEqual({ car: '7', crew: 'KIM', class: 'B', vehicle: 'K20 RWD Beetle' });
    expect(sheet.crews.find(c => c.car === '2')?.vehicle).toBeNull();
    expect(sheet.headlines[0]).toMatchObject({ scope: 'OVERALL', story: { type: 'lead_history' } });
  });

  it('skips stages without results', () => {
    const gap = buildRallySheet([mk('1', 'ALPHA', 'A', [100]), { ...mk('2', 'BRAVO', 'A', [101]), stageTimes: { '1': 101, '3': 99 } }], settings, 3);
    expect(gap.covers.stages).toEqual(['SS1', 'SS3']);
  });

  it('is accepted by the number check, with positions and gaps from any stage', () => {
    const draft = 'Bravo (#2) took the lead on SS2 and won SS3 in 1:45.00. Alpha (#1), in the Turbo 1NZ Corolla, is second overall. Charlie (#3) retired on SS3. Kim (#7) leads Group B in his K20 RWD Beetle.';
    const r = verifyDraft(draft, sheet);
    expect(r.issues).toEqual([]);
    expect(verifyDraft('Alpha (#1) is ninth overall.', sheet).issues.map(i => i.kind)).toEqual(['position']);
  });

  it('builds a rally sheet from real event data', () => {
    const real = buildRallySheet(drivers.map(decodeDriver), decodeSettings(settingsDoc), 12, 'Real Rally');
    expect(real.stageByStage.length).toBeGreaterThan(3);
    expect(real.overall.storylines.some(s => s.type === 'lead_history')).toBe(true);
    // Fits comfortably in a prompt.
    expect(JSON.stringify(real).length).toBeLessThan(120_000);
  });
});
