// Verbatim copy of the results calculation as it was in ResultsDisplay.tsx before
// it moved to src/lib/standings.ts. Used only by tests to prove the move changed nothing.
import type { Driver, Settings } from '../../src/types';

export function originalCalc(drivers: Driver[], settings: Settings) {
  const stages = Array.from({ length: 12 }, (_, i) => i + 1);


  const classes = Array.from(new Set(drivers.map(d => d.class.trim().toUpperCase()))).sort();

  // Pre-calculate class stats for highlighting and DNF substitution
  const classStats = (() => {
    const stats: Record<string, Record<string, { min: number; max: number }>> = {};
    
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
  })();

  // Pre-calculate overall stats for each stage
  const overallStats = (() => {
    const stats: Record<string, { min: number; max: number }> = {};
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
  })();

  // Calculate effective times per driver
  const processedDrivers = (() => {
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
  })();
  return { classes, classStats, overallStats, processedDrivers };
}
