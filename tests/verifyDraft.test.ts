import { describe, expect, it } from 'vitest';
import type { Driver, Settings } from '../src/types';
import { buildFactSheet } from '../src/lib/factSheet';
import { verifyDraft } from '../src/lib/verifyDraft';

const settings: Settings = { dnfPenalty: 60, dnfCalculationMethod: 'class' };
function mk(car: string, name: string, cls: string, times: number[], pens: number[] = []): Driver {
  const stageTimes: Record<string, number> = {};
  const stagePenalties: Record<string, number> = {};
  times.forEach((t, i) => { stageTimes[String(i + 1)] = t; stagePenalties[String(i + 1)] = pens[i] ?? 0; });
  return { id: `driver_${car}_${cls}`, name, carNumber: car, class: cls, stageTimes, stagePenalties, totalTimeSeconds: 0, updatedAt: null };
}

// SS2: BRAVO wins (01:45.00), takes the lead from ALPHA by 00:04.00. CHARLIE penalised 10s.
const sheet = buildFactSheet([
  mk('1', 'ALPHA', 'A', [100, 110]),
  mk('2', 'BRAVO', 'A', [101, 105]),
  mk('3', 'CHARLIE', 'A', [102, 120], [0, 10]),
  mk('7', 'KIM', 'B', [130, 131]),
], settings, 2, 'Test Rally');

const good =
  'SS2 belongs to #2 BRAVO, fastest in 01:45.00 and 1st on the stage. ' +
  '#2 BRAVO now leads by +00:04.00 from #1 ALPHA, who drops to 2nd. ' +
  'BRAVO (#2) gained 1 place. #3 CHARLIE took a 10s penalty and sits 3rd. ' +
  '#7 KIM leads Group B in 04:21.00.';

describe('verifyDraft', () => {
  it('passes a draft whose numbers all match the fact sheet', () => {
    const r = verifyDraft(good, sheet);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checked).toBeGreaterThan(10);
  });

  it('catches a wrong time', () => {
    const r = verifyDraft(good.replace('01:45.00', '01:44.00'), sheet);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([expect.objectContaining({ kind: 'time', text: '01:44.00' })]);
  });

  it('catches a wrong gap', () => {
    const r = verifyDraft(good.replace('+00:04.00', '+00:05.50'), sheet);
    expect(r.issues.map(i => [i.kind, i.text])).toEqual([['time', '+00:05.50']]);
  });

  it('catches a wrong position', () => {
    const r = verifyDraft(good.replace('who drops to 2nd', 'who drops to 3rd'), sheet);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([expect.objectContaining({ kind: 'position', text: '3rd' })]);
  });

  it('catches a wrong car-to-crew match', () => {
    const r = verifyDraft(good.replace('#1 ALPHA', '#1 CHARLIE'), sheet);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([expect.objectContaining({ kind: 'crew', text: '#1 CHARLIE' })]);
    expect(r.issues[0].message).toContain('ALPHA');
  });

  it('catches a swapped name in "NAME (#N)" form', () => {
    const r = verifyDraft(good.replace('BRAVO (#2)', 'ALPHA (#2)'), sheet);
    expect(r.issues.map(i => i.kind)).toContain('crew');
  });

  it('catches a car number that is not in the results', () => {
    const r = verifyDraft(good + ' #99 also starred.', sheet);
    expect(r.issues).toEqual([expect.objectContaining({ kind: 'car', text: '#99' })]);
  });

  it('catches a wrong penalty or place count', () => {
    expect(verifyDraft(good.replace('10s penalty', '20s penalty'), sheet).issues.map(i => i.kind)).toEqual(['time']);
    expect(verifyDraft(good.replace('gained 1 place', 'gained 3 places'), sheet).issues.map(i => i.kind)).toEqual(['places']);
  });

  it('accepts the same gap written in seconds', () => {
    expect(verifyDraft('#2 BRAVO leads by 4.00s.', sheet).ok).toBe(true);
  });

  it('does not treat stage counts as positions', () => {
    expect(verifyDraft('#2 BRAVO took the 2nd stage win of the day for the class leader in P1.', sheet).ok).toBe(true);
  });

  it('gives exact offsets for highlighting', () => {
    const text = good.replace('01:45.00', '01:44.00');
    const [issue] = verifyDraft(text, sheet).issues;
    expect(text.slice(issue.start, issue.end)).toBe('01:44.00');
  });
});
