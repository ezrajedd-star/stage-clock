/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Flag, ExternalLink } from 'lucide-react';
import type { Driver } from '../types';
import { checkBeforeClose } from '../lib/closeLegCheck';
import { FALLBACK_PARX_LEGS, type ParxLeg } from '../lib/parxConfig';

interface CloseLegDialogProps {
  drivers: Driver[];
  parxSiteUrl: string;
  /** Marks the leg closed in Firestore, then asks the server to publish. Throws with a readable message on failure. */
  onConfirm: (leg: ParxLeg) => Promise<{ actionsUrl?: string }>;
  onClose: () => void;
}

const ARM_SECONDS = 3;

// Two steps, like Reset: (1) choose the PARX leg and review the pre-flight check, (2) confirm.
export default function CloseLegDialog({ drivers, parxSiteUrl, onConfirm, onClose }: CloseLegDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [legs, setLegs] = useState<ParxLeg[]>(FALLBACK_PARX_LEGS);
  const [slug, setSlug] = useState('');
  const [countdown, setCountdown] = useState(ARM_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionsUrl, setActionsUrl] = useState<string | undefined>();
  const check = useMemo(() => checkBeforeClose(drivers), [drivers]);
  const leg = legs.find(l => l.slug === slug);

  // Live leg list from the PARX website (falls back to the built-in list).
  useEffect(() => {
    if (!parxSiteUrl) return;
    let active = true;
    fetch(`${parxSiteUrl}/api/legs.json`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { legs?: ParxLeg[] } | null) => { if (active && d?.legs?.length) setLegs(d.legs); })
      .catch(() => {});
    return () => { active = false; };
  }, [parxSiteUrl]);

  useEffect(() => {
    if (step !== 2 || countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [step, countdown]);

  const confirm = async () => {
    if (!leg) return;
    setBusy(true);
    setError(null);
    try {
      const r = await onConfirm(leg);
      setActionsUrl(r.actionsUrl);
      setStep(3);
    } catch (err: any) {
      setError(err?.message ?? 'Publishing failed.');
    } finally {
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
        aria-label={step === 1 ? 'Close leg and publish' : step === 2 ? 'Confirm close' : 'Published'}
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-(--bg-panel) border border-(--accent)/50 p-6 flex flex-col gap-4 font-mono z-10 shadow-[0_0_50px_rgba(255,77,0,0.15)]"
      >
        <div className="flex items-start gap-4">
          <div className="p-3 bg-(--accent)/10 border border-(--accent)/30 text-(--accent) shrink-0">
            {step === 3 ? <CheckCircle2 size={24} /> : <Flag size={24} />}
          </div>
          <div className="space-y-2 min-w-0">
            {step === 1 && (
              <>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Close leg &amp; publish</h3>
                <p className="text-[11px] text-(--text-secondary) leading-relaxed">
                  The final results go to the PARX Open website (results, standings and driver pages) within about 2 minutes. The board is locked while the leg is closed; you can reopen it to fix a time and publish again.
                </p>
              </>
            )}
            {step === 2 && (
              <>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Publish Round {leg?.round} · {leg?.name}?</h3>
                <p className="text-[11px] text-(--text-secondary) leading-relaxed">
                  {check.visible} entries over {check.stageCount} stages will become the official results for this leg on PARX Open.
                </p>
              </>
            )}
            {step === 3 && (
              <>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Leg closed — publishing</h3>
                <p className="text-[11px] text-(--text-secondary) leading-relaxed">
                  PARX Open is importing the results now. They appear on the website in about 2 minutes.
                </p>
              </>
            )}
          </div>
        </div>

        {step === 1 && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] text-(--text-secondary) uppercase tracking-widest">PARX Open leg</span>
              <select
                value={slug}
                onChange={e => setSlug(e.target.value)}
                className="h-10 bg-(--bg-deep) border border-(--line) focus:border-(--accent) outline-none px-2 text-white text-sm"
              >
                <option value="" disabled>Choose the leg…</option>
                {legs.map(l => (
                  <option key={l.slug} value={l.slug}>
                    R{l.round} · {l.name}{l.hasResults ? ' (has results — will be replaced)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="border border-(--line) p-3 space-y-2 text-[11px]">
              <p className="text-(--text-secondary) uppercase tracking-widest text-[10px]">Pre-flight check</p>
              <p className="text-white">
                {check.visible} entries · {check.stageCount} stages · {check.hidden} hidden rows (not published)
              </p>
              {check.incomplete.length === 0 && check.duplicateNames.length === 0 && (
                <p className="text-(--accent-ready) flex items-center gap-1.5"><CheckCircle2 size={12} /> Every crew has a time, DNF or DNS on every stage.</p>
              )}
              {check.incomplete.length > 0 && (
                <div className="text-amber-400 space-y-1">
                  <p className="flex items-center gap-1.5 font-bold uppercase"><AlertTriangle size={12} /> Missing stage times — published as DNF (unclassified):</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {check.incomplete.map(i => (
                      <li key={`${i.carNumber}-${i.class}`}>#{i.carNumber} {i.name} ({i.class}): {i.missing.map(s => `SS${s}`).join(', ')}</li>
                    ))}
                  </ul>
                  <p className="text-(--text-secondary)">Enter DNF or DNS for those stages first if the crew should be classified.</p>
                </div>
              )}
              {check.duplicateNames.length > 0 && (
                <div className="text-amber-400 space-y-1">
                  <p className="flex items-center gap-1.5 font-bold uppercase"><AlertTriangle size={12} /> Same driver on more than one visible row:</p>
                  <ul className="list-disc pl-5">{check.duplicateNames.map(n => <li key={n}>{n}</li>)}</ul>
                  <p className="text-(--text-secondary)">Hide the wrong row — the import stops if one driver has two visible entries.</p>
                </div>
              )}
            </div>
          </>
        )}

        {error && <p className="text-[10px] text-red-400 font-bold uppercase bg-red-500/10 border border-red-500/20 p-2 normal-case">{error}</p>}

        {step === 1 && (
          <div className="flex items-center justify-end gap-3">
            <button onClick={onClose} className={`${button} border border-(--line) text-(--text-secondary) hover:text-white`}>Cancel</button>
            <button
              onClick={() => { setStep(2); setCountdown(ARM_SECONDS); }}
              disabled={!leg || check.visible === 0}
              className={`${button} border border-(--accent) text-(--accent) hover:bg-(--accent)/10`}
            >
              Continue
            </button>
          </div>
        )}
        {step === 2 && (
          <div className="flex items-center justify-between gap-3">
            <button onClick={confirm} disabled={busy || countdown > 0} className={`${button} bg-(--accent) hover:bg-white text-black flex items-center gap-1.5`}>
              <Flag size={12} />
              {busy ? 'Publishing…' : countdown > 0 ? `Close & publish (${countdown})` : 'Close & publish'}
            </button>
            <button onClick={() => setStep(1)} disabled={busy} className={`${button} border border-(--line) text-white hover:border-white`}>Back</button>
          </div>
        )}
        {step === 3 && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {actionsUrl && (
              <a href={actionsUrl} target="_blank" rel="noopener noreferrer" className={`${button} border border-(--line) text-(--text-secondary) hover:text-white flex items-center gap-1.5`}>
                Import status <ExternalLink size={11} />
              </a>
            )}
            {parxSiteUrl && leg && (
              <a href={`${parxSiteUrl}/results/${leg.slug}`} target="_blank" rel="noopener noreferrer" className={`${button} border border-(--accent) text-(--accent) hover:bg-(--accent)/10 flex items-center gap-1.5`}>
                View on PARX Open <ExternalLink size={11} />
              </a>
            )}
            <button onClick={onClose} className={`${button} bg-(--accent) text-black hover:bg-white`}>Done</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
