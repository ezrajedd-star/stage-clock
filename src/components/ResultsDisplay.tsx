/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Driver, Settings } from '../types';
import { secondsToTime, formatPenalty } from '../lib/rallyUtils';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Clock, Hash, Download, ShieldOff, Eye, List, LayoutGrid, Trash2, AlertTriangle } from 'lucide-react';

interface ResultsDisplayProps {
  drivers: Driver[];
  settings: Settings;
}

const getOrdinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const getPositionStyle = (n: number): string => {
  if (n === 1) return "text-yellow-400 font-extrabold";
  if (n === 2) return "text-slate-300 font-extrabold";
  if (n === 3) return "text-amber-500 font-extrabold pb-0.5 border-b border-amber-500/20";
  return "text-white/40 font-bold";
};

interface MasterEntryListProps extends ResultsDisplayProps {
  onToggleHidden?: (id: string, currentState: boolean) => void;
  onDeleteDriver?: (id: string) => void;
  showHidden: boolean;
  onToggleShowHidden: () => void;
}

export function MasterEntryList({ drivers, settings, onToggleHidden, onDeleteDriver, showHidden, onToggleShowHidden }: MasterEntryListProps) {
  // Phones open on the leaderboard (fits the screen); larger screens on stage times.
  const [viewMode, setViewMode] = useState<'stages' | 'leaderboard'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'leaderboard' : 'stages'
  );
  const [driverToDelete, setDriverToDelete] = useState<Driver | null>(null);
  const stages = Array.from({ length: 12 }, (_, i) => i + 1);

  // Display only: show stage columns that have at least one recorded result.
  const visibleStages = stages.filter(s => drivers.some(d => d.stageTimes?.[s.toString()] !== undefined));
  // Row controls (hide/delete) only for authorized operators.
  const showOps = viewMode === 'stages' && !!(onToggleHidden || onDeleteDriver);
  // In stage view, POS / # / DRIVER stay pinned while stage columns scroll sideways.
  const pin = viewMode === 'stages';

  const classes = Array.from(new Set(drivers.map(d => d.class.trim().toUpperCase()))).sort();

  // Pre-calculate class stats for highlighting and DNF substitution
  const classStats = useMemo(() => {
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
  }, [drivers, classes, stages]);

  // Pre-calculate overall stats for each stage
  const overallStats = useMemo(() => {
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
  }, [drivers, stages]);

  // Calculate effective times per driver
  const processedDrivers = useMemo(() => {
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
  }, [drivers, classStats, overallStats, settings.dnfPenalty, settings.dnfCalculationMethod, stages]);

  const exportToCSV = () => {
    const headers = ['Pos', 'Car', 'Driver', 'Class', ...visibleStages.map(s => `SS${s}`), 'Total Time'];
    const rows = processedDrivers
      .filter(d => showHidden || !d.isHidden)
      .sort((a, b) => a.effectiveTotal - b.effectiveTotal)
      .map((d, index) => [
        index + 1,
        d.carNumber,
        `"${d.name}"`,
        `"${d.class}"`,
        ...visibleStages.map(s => {
          const time = d.stageTimes[s.toString()];
          const effectiveTime = d.effectiveStageTimes[s.toString()];
          const penalty = d.stagePenalties[s.toString()];
          const isDnf = d.isDnfEntry[s.toString()];
          
          if (time === undefined) return '';
          
          let display = secondsToTime(effectiveTime);
          if (isDnf) {
            const type = time === -1 ? 'DNF' : 'DNS';
            display = `${type} (${display})`;
          }
          
          return `${display}${penalty ? ` (+${penalty}s)` : ''}`.replace(/:/g, '.');
        }),
        secondsToTime(d.effectiveTotal)
      ]);

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `stage_clock_results_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="shrink-0 p-2 border-b border-(--line) bg-(--bg-header) flex justify-between items-center gap-2 text-white z-20">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="hidden sm:block text-[10px] font-black uppercase tracking-widest text-(--text-secondary)">Master Results • {viewMode === 'stages' ? 'Stage Times' : 'Leaderboard'}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="px-1.5 py-0.5 bg-(--accent)/10 border border-(--accent)/20 rounded text-[8px] text-(--accent) font-bold uppercase">
              {drivers.length} Entries
            </div>
            {viewMode === 'stages' && (
              <button 
                onClick={onToggleShowHidden}
                className={`text-[8px] px-1.5 py-0.5 border ${showHidden ? 'bg-(--accent) text-black border-(--accent)' : 'text-(--text-secondary) border-(--line)'} uppercase font-bold transition-all`}
              >
                {showHidden ? 'Hide DSQ' : 'Show DSQ'}
              </button>
            )}
            <div className="hidden sm:block h-4 w-px bg-(--line)/30 mx-1" />
            <button 
              onClick={() => setViewMode('stages')}
              className={`flex items-center gap-1 text-[8px] px-1.5 py-0.5 border ${viewMode === 'stages' ? 'bg-(--accent) text-black border-(--accent)' : 'text-(--text-secondary) border-(--line)'} uppercase font-bold transition-all`}
            >
              <LayoutGrid size={10} /> Stages
            </button>
            <button 
              onClick={() => setViewMode('leaderboard')}
              className={`flex items-center gap-1 text-[8px] px-1.5 py-0.5 border ${viewMode === 'leaderboard' ? 'bg-(--accent) text-black border-(--accent)' : 'text-(--text-secondary) border-(--line)'} uppercase font-bold transition-all`}
            >
              <List size={10} /> Leaderboard
            </button>
          </div>
        </div>
        <button 
          onClick={exportToCSV}
          className="flex items-center gap-1.5 bg-(--bg-darker) hover:bg-(--accent) text-white hover:text-black px-2 py-1 font-mono text-[8px] font-bold uppercase transition-colors border border-(--line)/40"
        >
          <Download size={10} />
          CSV
        </button>
      </div>

      <div className={`flex-1 overflow-auto custom-scrollbar ${viewMode === 'leaderboard' ? 'p-2 bg-(--bg-darker)' : ''}`}>
        <div className={viewMode === 'leaderboard' ? 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2 h-max' : ''}>
          {classes.map(className => {
            const classDrivers = processedDrivers
              .filter(d => d.class.trim().toUpperCase() === className && (showHidden || !d.isHidden))
              .sort((a, b) => a.effectiveTotal - b.effectiveTotal);

            if (classDrivers.length === 0) return null;

            const leader = classDrivers[0];

            return (
              <div key={className} className={`mb-4 last:mb-0 ${viewMode === 'leaderboard' ? 'border border-(--line) bg-(--bg-panel) h-fit flex flex-col' : 'min-w-full w-max'}`}>
                <div className={`sticky top-0 z-10 bg-(--bg-header) border-y border-(--line) px-4 py-1 flex items-center justify-between ${viewMode === 'leaderboard' ? 'border-t-0' : ''}`}>
                  <span className="sticky left-4 text-[9px] font-black text-(--accent) uppercase tracking-[0.2em] italic">
                     {className} • CLASS GROUPING
                  </span>
                </div>
                <table className="w-full text-left border-collapse font-mono text-[10px]">
                  <thead className="text-(--text-secondary) bg-(--bg-deep)/50">
                    <tr className="border-b border-(--line)/10">
                      {showOps && (
                        <th className="px-2 py-1.5 font-black uppercase tracking-widest text-[8px] w-16 text-center">OPS</th>
                      )}
                      <th className={`px-1 sm:px-2 py-1.5 font-black uppercase tracking-widest text-center text-(--text-secondary) ${pin ? 'sticky left-0 z-[2] bg-(--bg-panel) w-10 min-w-10 max-w-10' : 'w-10 sm:w-12'}`}>POS</th>
                      <th className={`px-2 sm:px-3 py-1.5 font-black uppercase tracking-widest ${pin ? 'sticky left-10 z-[2] bg-(--bg-panel) w-12 min-w-12 max-w-12' : 'w-10 sm:w-12'}`}>#</th>
                      <th className={`px-2 sm:px-3 py-1.5 font-black uppercase tracking-widest ${pin ? 'sticky left-22 z-[2] bg-(--bg-panel) w-28 min-w-28 max-w-28 border-r border-(--line)/30' : ''}`}>DRIVER</th>
                      {viewMode === 'leaderboard' && (
                        <th className="hidden sm:table-cell px-3 py-1.5 font-black uppercase tracking-widest text-center w-16">STAGES</th>
                      )}
                      <th className={`px-2 sm:px-3 py-1.5 font-black uppercase tracking-widest text-right text-(--accent) ${viewMode === 'leaderboard' ? 'w-20' : 'w-24'}`}>TOTAL</th>
                      <th className={`px-2 sm:px-3 py-1.5 font-black uppercase tracking-widest text-right text-(--text-secondary) border-(--line)/20 ${viewMode === 'leaderboard' ? 'w-20' : 'w-24 border-r'}`}>DIFF</th>
                      {viewMode === 'stages' && visibleStages.map(s => (
                        <th key={s} className="px-1 py-1.5 font-black uppercase tracking-widest text-center border-r border-(--line)/10 shrink-0 min-w-[55px]">SS{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--bg-darker)">
                    <AnimatePresence mode="popLayout">
                      {classDrivers.map((d, index) => {
                        const dnfDnsCount = (Object.values(d.stageTimes) as number[]).filter(v => v < 0).length;
                        const isLeader = leader && d.id === leader.id;
                        
                        let diff = "---";
                        if (leader) {
                          if (isLeader) diff = "LEADER";
                          else {
                            const gap = d.effectiveTotal - leader.effectiveTotal;
                            diff = `+${secondsToTime(gap)}`;
                          }
                        }

                        return (
                          <motion.tr 
                            layout
                            key={d.id} 
                            initial={{ opacity: 0, x: -5 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`${d.isHidden ? 'opacity-40 grayscale bg-red-950/10' : ''} hover:bg-(--accent)/5 group transition-colors odd:bg-(--bg-panel) even:bg-(--bg-deep)`}
                          >
                            {showOps && (
                              <td className="px-2 py-0.5 whitespace-nowrap text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  {onToggleHidden && (
                                    <button 
                                      onClick={() => onToggleHidden(d.id, !!d.isHidden)}
                                      className={`p-1 transition-colors ${d.isHidden ? 'text-red-500 hover:text-red-400' : 'text-(--text-subtle) hover:text-(--accent)'}`}
                                      title={d.isHidden ? "Unhide/Re-qualify" : "Hide/Disqualify"}
                                    >
                                      {d.isHidden ? <ShieldOff size={11} /> : <Eye size={11} />}
                                    </button>
                                  )}
                                  {onDeleteDriver && (
                                    <button 
                                      onClick={() => setDriverToDelete(d)}
                                      className="p-1 text-red-500/60 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                      title="Delete Driver"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                            <td className={`px-1 sm:px-2 py-0.5 text-center font-bold text-[10px] tabular-nums ${getPositionStyle(index + 1)} ${pin ? 'sticky left-0 z-[1] bg-inherit w-10 min-w-10 max-w-10' : ''}`}>
                              {getOrdinal(index + 1)}
                            </td>
                            <td className={`px-2 sm:px-3 py-0.5 font-black text-(--accent) italic ${viewMode === 'leaderboard' ? 'text-sm' : 'text-base'} ${pin ? 'sticky left-10 z-[1] bg-inherit w-12 min-w-12 max-w-12' : ''}`}>
                              {d.carNumber}
                            </td>
                            <td className={`px-2 sm:px-3 py-0.5 min-w-0 ${pin ? 'sticky left-22 z-[1] bg-inherit w-28 min-w-28 max-w-28 border-r border-(--line)/30' : ''}`}>
                              <div className="font-black text-white uppercase text-[10px] leading-tight tabular-nums truncate max-w-[100px]" title={d.name}>{d.name}</div>
                              {viewMode === 'leaderboard' && dnfDnsCount > 0 && (
                                <div className="flex gap-0.5 mt-0.5">
                                  {Array.from({ length: dnfDnsCount }).map((_, i) => (
                                    <div key={i} className="w-1 h-1 rounded-full bg-red-500 shadow-[0_0_3px_rgba(239,68,68,0.5)]" />
                                  ))}
                                </div>
                              )}
                            </td>
                            {viewMode === 'leaderboard' && (
                              <td className="hidden sm:table-cell px-3 py-0.5 text-center">
                                <div className="text-[10px] font-bold text-white/70">
                                  {Object.values(d.stageTimes).filter(v => v !== undefined).length}
                                </div>
                              </td>
                            )}
                            <td className="px-2 sm:px-3 py-0.5 text-right whitespace-nowrap">
                              <div className={`font-black ${viewMode === 'leaderboard' ? 'text-[11px]' : 'text-[12px]'} ${dnfDnsCount > 0 ? 'text-red-400' : 'text-(--accent)'}`}>
                                {secondsToTime(d.effectiveTotal)}
                              </div>
                            </td>
                            <td className={`px-2 sm:px-3 py-0.5 text-right whitespace-nowrap border-(--line)/20 ${viewMode === 'stages' ? 'border-r' : ''}`}>
                              <div className={`text-[9px] font-bold ${isLeader ? 'text-(--accent-ready)' : 'text-(--text-secondary)'}`}>
                                {diff}
                              </div>
                            </td>
                            {viewMode === 'stages' && visibleStages.map(s => {
                              const stageKey = s.toString();
                              const time = d.stageTimes[stageKey];
                              const effectiveTime = d.effectiveStageTimes[stageKey];
                              const isDnf = d.isDnfEntry[stageKey];
                              const penalty = d.stagePenalties[stageKey] || 0;
                              const inclusiveTime = time > 0 ? time + penalty : 0;
                              
                              let timeDisplay = "---";
                              let colorClass = "text-white";
                              
                              if (time === -1) timeDisplay = "DNF";
                              else if (time === -2) timeDisplay = "DNS";
                              else if (time > 0) timeDisplay = secondsToTime(inclusiveTime).replace(/^00:/, '');

                              // Highlighting logic
                              const stats = classStats[className]?.[stageKey];
                              if (isDnf) {
                                colorClass = "text-red-400";
                                timeDisplay = `(${secondsToTime(effectiveTime).replace(/^00:/, '')})*`;
                              } else if (stats && time > 0) {
                                if (inclusiveTime === stats.min) colorClass = "text-fuchsia-400";
                                else if (inclusiveTime === stats.max) colorClass = "text-red-500";
                              }

                              return (
                                <td key={s} className="px-1 py-0.5 text-center border-r border-(--line)/10 tabular-nums">
                                  <div className={`font-bold text-[10px] ${time !== undefined ? colorClass : 'text-(--text-subtle)'}`}>
                                    {timeDisplay}
                                  </div>
                                  {penalty > 0 && <span className="text-red-500 font-black text-[7px] block leading-none mt-0.5">+{penalty}</span>}
                                </td>
                              );
                            })}
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom Confirmation Dialog for Deleting Driver */}
      <AnimatePresence>
        {driverToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDriverToDelete(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xs"
            />
            
            {/* Modal Card */}
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="relative w-full max-w-md bg-(--bg-panel) border border-(--line) p-6 rounded shadow-[0_0_50px_rgba(239,68,68,0.2)] flex flex-col gap-4 font-mono z-10"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-500 shrink-0">
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider mb-1">
                    Confirm Deletion
                  </h3>
                  <p className="text-[10px] text-(--text-secondary) uppercase tracking-wide leading-relaxed">
                    Deleting this Driver cannot be undone, are you sure you want to proceed?
                  </p>
                </div>
              </div>

              {/* Driver Details Box */}
              <div className="bg-(--bg-deep) border border-(--line)/40 p-3 rounded text-[10px] flex flex-col gap-1.5 text-(--text-secondary)">
                <div>
                  <span className="text-white/40 font-bold">DRIVER:</span> <span className="text-white font-black">{driverToDelete.name}</span>
                </div>
                <div className="flex gap-4">
                  <div>
                    <span className="text-white/40 font-bold">CAR NUMBER:</span> <span className="text-(--accent) font-black">{driverToDelete.carNumber}</span>
                  </div>
                  <div>
                    <span className="text-white/40 font-bold">CLASS:</span> <span className="text-white font-black">{driverToDelete.class}</span>
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-3 font-bold text-[10px] uppercase tracking-wider mt-2">
                <button
                  onClick={() => setDriverToDelete(null)}
                  className="px-4 py-2 border border-(--line) hover:border-(--text-secondary) text-(--text-secondary) hover:text-white rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (onDeleteDriver) {
                      onDeleteDriver(driverToDelete.id);
                    }
                    setDriverToDelete(null);
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded transition-colors font-black flex items-center gap-1.5 shadow-[0_0_15px_rgba(220,38,38,0.3)]"
                >
                  <Trash2 size={12} /> Yes, Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Clean up: Component removed as functionality merged into MasterEntryList
export function ClassStandings({ drivers: _ }: ResultsDisplayProps) { return null; }
