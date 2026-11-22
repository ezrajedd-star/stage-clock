/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Driver } from '../types';

// Pre-flight check shown before an admin closes a leg. It mirrors what the PARX Open importer
// does: hidden rows are skipped, and a crew missing a time on a stage that others ran is
// published as DNF (unclassified) — so the operator can enter DNF/DNS first if that's wrong.

export interface CloseLegCheck {
  visible: number;
  hidden: number;
  stageCount: number;
  incomplete: { name: string; carNumber: string; class: string; missing: number[] }[];
  duplicateNames: string[];
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

export function checkBeforeClose(drivers: Driver[]): CloseLegCheck {
  const visible = drivers.filter(d => !d.isHidden);
  const keys = visible.flatMap(d => Object.keys(d.stageTimes ?? {}).map(Number)).filter(n => n >= 1 && n <= 12);
  const stageCount = keys.length ? Math.max(...keys) : 0;
  const ran = (s: number) => visible.some(d => d.stageTimes?.[String(s)] !== undefined);
  const incomplete = visible
    .map(d => {
      const defined = Object.values(d.stageTimes ?? {});
      const allDns = defined.length > 0 && defined.every(t => t === -2);
      const missing = defined.length === 0 || allDns ? [] : Array.from({ length: stageCount }, (_, i) => i + 1).filter(s => ran(s) && d.stageTimes?.[String(s)] === undefined);
      return { name: d.name, carNumber: d.carNumber, class: d.class, missing };
    })
    .filter(x => x.missing.length > 0);
  const counts = new Map<string, string[]>();
  visible.forEach(d => counts.set(norm(d.name), [...(counts.get(norm(d.name)) ?? []), `${d.name} #${d.carNumber}`]));
  const duplicateNames = [...counts.values()].filter(v => v.length > 1).map(v => v.join(' / '));
  return { visible: visible.length, hidden: drivers.length - visible.length, stageCount, incomplete, duplicateNames };
}
