/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Driver, Settings } from '../types';

// The results calculation used by the results board. Moved here unchanged from
// ResultsDisplay.tsx so the board and the Stage Report Writer share one source
// of truth. `stages` limits which stages count (e.g. [1, 2, 3] for standings
// after SS3); the board passes all 12.

export const ALL_STAGES = Array.from({ length: 12 }, (_, i) => i + 1);

export type StageStats = Record<string, { min: number; max: number }>;

export interface ProcessedDriver extends Driver {
  effectiveTotal: number;
  effectiveStageTimes: Record<string, number>;
  isDnfEntry: Record<string, boolean>;
}

export const classKey = (d: Driver) => d.class.trim().toUpperCase();

export function getClasses(drivers: Driver[]): string[] {
  return Array.from(new Set(drivers.map(classKey))).sort();
}

// Per class, per stage: fastest and slowest time including penalty (valid times only).
export function computeClassStats(drivers: Driver[], classes: string[], stages: number[]) {
  const stats: Record<string, StageStats> = {};

  classes.forEach(cls => {
    stats[cls] = {};
    stages.forEach(s => {
      const stageKey = s.toString();
      const times = drivers
        .filter(d => d.class.trim().toUpperCase() === cls && d.stageTimes[stageKey] > 0)
        .map(d => d.stageTimes[stageKey] + (d.stagePenalties[stageKey] || 0));

      if (times.length > 0) {
        stats[cls][stageKey] = {
          min: Math.min(...times),
          max: Math.max(...times)
        };
      }
    });
  });

  return stats;
}

// Per stage across all classes: fastest and slowest time including penalty.
export function computeOverallStats(drivers: Driver[], stages: number[]) {
  const stats: StageStats = {};
  stages.forEach(s => {
    const stageKey = s.toString();
    const times = drivers
      .filter(d => d.stageTimes[stageKey] > 0)
      .map(d => d.stageTimes[stageKey] + (d.stagePenalties[stageKey] || 0));

    if (times.length > 0) {
      stats[stageKey] = {
        min: Math.min(...times),
        max: Math.max(...times)
      };
    }
  });
  return stats;
}

// Effective stage times: valid time + penalty; DNF/DNS = slowest (class or overall) + DNF penalty.
export function computeProcessedDrivers(
  drivers: Driver[],
  settings: Settings,
  classStats: Record<string, StageStats>,
  overallStats: StageStats,
  stages: number[],
): ProcessedDriver[] {
  return drivers.map(d => {
    const cls = d.class.trim().toUpperCase();
    let effectiveTotal = 0;
    const effectiveStageTimes: Record<string, number> = {};
    const isDnfEntry: Record<string, boolean> = {};

    stages.forEach(s => {
      const stageKey = s.toString();
      const time = d.stageTimes[stageKey];
      const penalty = d.stagePenalties[stageKey] || 0;

      let effectiveTime = 0;
      if (time > 0) {
        effectiveTime = time + penalty;
      } else if (time < 0) {
        // DNF/DNS
        const isOverall = settings.dnfCalculationMethod === 'overall';
        const maxTime = isOverall
          ? (overallStats[stageKey]?.max || 0)
          : (classStats[cls]?.[stageKey]?.max || 0);
        effectiveTime = maxTime + settings.dnfPenalty;
        isDnfEntry[stageKey] = true;
      }

      effectiveStageTimes[stageKey] = effectiveTime;
      if (effectiveTime > 0) {
        effectiveTotal += effectiveTime;
      }
    });

    return {
      ...d,
      effectiveTotal,
      effectiveStageTimes,
      isDnfEntry
    };
  });
}

// Convenience: run the full calculation for a set of stages.
export function computeResults(drivers: Driver[], settings: Settings, stages: number[] = ALL_STAGES) {
  const classes = getClasses(drivers);
  const classStats = computeClassStats(drivers, classes, stages);
  const overallStats = computeOverallStats(drivers, stages);
  const processed = computeProcessedDrivers(drivers, settings, classStats, overallStats, stages);
  return { classes, classStats, overallStats, processed };
}
