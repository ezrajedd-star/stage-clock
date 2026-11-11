/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import type { Driver, Settings } from '../types';

interface ResetEventDialogProps {
  drivers: Driver[];
  settings: Settings;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

// Seconds the final "Yes, reset" button stays disabled, so a double tap on the
// first dialog's button can't confirm the second one by accident.
const ARM_SECONDS = 3;

// Two-step confirmation for wiping the event: step 1 warns that the data can't be
// retrieved (and offers a backup), step 2 asks "Are you sure?".
export default function ResetEventDialog({ drivers, settings, onConfirm, onClose }: ResetEventDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [countdown, setCountdown] = useState(ARM_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 2 || countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [step, countdown]);

  const timedEntries = drivers.filter(d => Object.keys(d.stageTimes ?? {}).length > 0).length;

  const downloadBackup = () => {
    const backup = { exportedAt: new Date().toISOString(), settings, drivers };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `stage_clock_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'The reset failed. Nothing may have been deleted; check the board and try again.');
      setBusy(false);
    }
  };

  const button = 'h-10 px-4 uppercase font-black text-[10px] tracking-widest transition-colors disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={busy ? undefined : onClose} className="absolute inset-0 bg-black/85 backdrop-blur-xs" />
      <motion.div
        key={step}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        role="alertdialog"
        aria-label={step === 1 ? 'Reset event data' : 'Are you sure?'}
        className="relative w-full max-w-md bg-(--bg-panel) border border-red-500/40 p-6 flex flex-col gap-4 font-mono z-10 shadow-[0_0_50px_rgba(239,68,68,0.2)]"
      >
        <div className="flex items-start gap-4">
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 shrink-0">
            <AlertTriangle size={24} />
          </div>
          {step === 1 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Reset event data?</h3>
              <p className="text-[11px] text-(--text-secondary) leading-relaxed">
                This deletes all {drivers.length} entries ({timedEntries} with times), every stage time, penalty and DNF/DNS, and clears the event name.
                The board will be blank for everyone.
              </p>
              <p className="text-[11px] text-red-400 font-bold uppercase leading-relaxed">You cannot retrieve the existing data if you reset.</p>
              <p className="text-[10px] text-(--text-subtle) leading-relaxed">Kept: the operator list and the DNF settings.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Are you sure?</h3>
              <p className="text-[11px] text-(--text-secondary) leading-relaxed">
                All results will be permanently deleted. This cannot be undone.
              </p>
            </div>
          )}
        </div>

        {step === 1 && (
          <button
            onClick={downloadBackup}
            className="w-full h-9 flex items-center justify-center gap-2 border border-(--line) text-(--text-secondary) hover:text-white hover:border-white uppercase font-bold text-[9px] tracking-widest transition-colors"
          >
            <Download size={12} /> Download a backup first (optional)
          </button>
        )}

        {error && <p className="text-[10px] text-red-400 font-bold uppercase bg-red-500/10 border border-red-500/20 p-2">{error}</p>}

        {step === 1 ? (
          <div className="flex items-center justify-end gap-3">
            <button onClick={onClose} className={`${button} border border-(--line) text-(--text-secondary) hover:text-white`}>Cancel</button>
            <button onClick={() => { setStep(2); setCountdown(ARM_SECONDS); }} className={`${button} border border-red-500 text-red-400 hover:bg-red-500/10`}>
              I understand, continue
            </button>
          </div>
        ) : (
          // Confirm on the left, cancel on the right: the opposite of step 1.
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={confirm}
              disabled={busy || countdown > 0}
              className={`${button} bg-red-600 hover:bg-red-500 text-white flex items-center gap-1.5`}
            >
              <Trash2 size={12} />
              {busy ? 'Resetting…' : countdown > 0 ? `Yes, reset (${countdown})` : 'Yes, reset'}
            </button>
            <button onClick={onClose} disabled={busy} className={`${button} border border-(--line) text-white hover:border-white`}>No, keep data</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
