/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Converts MM:SS.sss string to total seconds.
 * Supports MM:SS.sss or H:MM:SS.sss (any number of decimals)
 */
export function timeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  
  const parts = timeStr.trim().split(':').map(Number);
  
  if (parts.length === 3) {
    // HH:MM:SS.sss
    const [h, m, s] = parts;
    return (h * 3600) + (m * 60) + s;
  } else if (parts.length === 2) {
    // MM:SS.sss
    const [m, s] = parts;
    return (m * 60) + s;
  } else if (parts.length === 1) {
    // SS.sss
    return parts[0];
  }
  
  return 0;
}

// Times are kept to the millisecond (the timing machine gives 3 decimals).
export const TIME_DECIMALS = 3;
export const toMs = (seconds: number) => Math.round(seconds * 1000);

/**
 * Converts total seconds to MM:SS.sss or H:MM:SS.sss format.
 */
export function secondsToTime(totalSeconds: number): string {
  if (totalSeconds === -1) return "DNF";
  if (totalSeconds === -2) return "DNS";
  if (totalSeconds === 0) return "00:00.000";
  
  // Work in whole milliseconds so float noise (e.g. 59.9999999) never shows as "60.000".
  const ms = toMs(totalSeconds);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = (ms % 60_000) / 1000;
  
  const mStr = m.toString().padStart(2, '0');
  const sStr = s.toFixed(TIME_DECIMALS).padStart(3 + TIME_DECIMALS, '0');
  
  if (h > 0) {
    return `${h}:${mStr}:${sStr}`;
  }
  return `${mStr}:${sStr}`;
}

// Gap for the board, WRC style without leading zeros: "+0.425", "+3.326", "+20.096", "+1:13.040".
export function formatGap(seconds: number): string {
  return `+${secondsToTime(seconds).replace(/^00:0?(?=\d)/, '').replace(/^0(\d:)/, '$1')}`;
}

export function formatPenalty(penaltySeconds: number): string {
  if (penaltySeconds <= 0) return "";
  return `+${secondsToTime(penaltySeconds)}`;
}

export function calculateTotalTime(stageTimes: Record<string, number>, stagePenalties: Record<string, number>, droppedStages: string[] = []): number {
  const counted = (key: string) => !droppedStages.includes(key);

  // Sum up all positive times (skip DNF/DNS values like -1, -2, and dropped runs)
  const timesSum = Object.entries(stageTimes).reduce((acc, [k, t]) => acc + (t > 0 && counted(k) ? t : 0), 0);
  const penaltiesSum = Object.entries(stagePenalties).reduce((acc, [k, p]) => acc + (p > 0 && counted(k) ? p : 0), 0);
  return timesSum + penaltiesSum;
}
