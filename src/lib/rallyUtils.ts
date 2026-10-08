/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Converts MM:SS.SS string to total seconds.
 * Supports MM:SS.SS or H:MM:SS.SS
 */
export function timeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  
  const parts = timeStr.trim().split(':').map(Number);
  
  if (parts.length === 3) {
    // HH:MM:SS.SS
    const [h, m, s] = parts;
    return (h * 3600) + (m * 60) + s;
  } else if (parts.length === 2) {
    // MM:SS.SS
    const [m, s] = parts;
    return (m * 60) + s;
  } else if (parts.length === 1) {
    // SS.SS
    return parts[0];
  }
  
  return 0;
}

/**
 * Converts total seconds to MM:SS.SS or H:MM:SS.SS format.
 */
export function secondsToTime(totalSeconds: number): string {
  if (totalSeconds === -1) return "DNF";
  if (totalSeconds === -2) return "DNS";
  if (totalSeconds === 0) return "00:00.00";
  
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  
  const mStr = m.toString().padStart(2, '0');
  const sStr = s.toFixed(2).padStart(5, '0');
  
  if (h > 0) {
    return `${h}:${mStr}:${sStr}`;
  }
  return `${mStr}:${sStr}`;
}

export function formatPenalty(penaltySeconds: number): string {
  if (penaltySeconds <= 0) return "";
  return `+${secondsToTime(penaltySeconds)}`;
}

export function calculateTotalTime(stageTimes: Record<string, number>, stagePenalties: Record<string, number>): number {
  const times = Object.values(stageTimes);
  
  // Sum up all positive times (skip DNF/DNS values like -1, -2)
  const timesSum = times.reduce((acc, t) => acc + (t > 0 ? t : 0), 0);
  const penaltiesSum = Object.values(stagePenalties).reduce((acc, p) => acc + (p > 0 ? p : 0), 0);
  return timesSum + penaltiesSum;
}
