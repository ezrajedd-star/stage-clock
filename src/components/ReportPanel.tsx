/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { FileText, X, Copy, Check, RefreshCw, ShieldCheck, AlertTriangle, Activity } from 'lucide-react';
import type { Driver, Settings } from '../types';
import { buildFactSheet } from '../lib/factSheet';
import { verifyDraft } from '../lib/verifyDraft';
import {
  REPORT_FORMATS, REPORT_ERRORS, MAX_NOTES_LENGTH, MAX_EVENT_NAME_LENGTH,
  type ReportFormat, type ReportResponse, type ReportIssue,
} from '../lib/reportConfig';

interface ReportPanelProps {
  drivers: Driver[];
  settings: Settings;
  getIdToken: () => Promise<string | null>;
  onSaveEventName: (name: string) => void;
  onClose: () => void;
}

const label = 'text-(--text-secondary) flex items-center gap-1.5 uppercase font-black text-[9px] tracking-wider';
const input = 'w-full bg-(--bg-deep) border border-(--line) text-white px-2 py-1.5 focus:border-(--accent) focus:outline-none font-bold text-xs';

// Draft with the unverified items highlighted.
function Highlighted({ text, issues }: { text: string; issues: ReportIssue[] }) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  issues.forEach((issue, i) => {
    if (issue.start < pos) return;
    parts.push(text.slice(pos, issue.start));
    parts.push(<mark key={i} title={issue.message} className="bg-red-500/30 text-red-200 px-0.5 rounded-sm">{text.slice(issue.start, issue.end)}</mark>);
    pos = issue.end;
  });
  parts.push(text.slice(pos));
  return <div className="whitespace-pre-wrap text-xs leading-relaxed text-(--text-primary)">{parts}</div>;
}

export default function ReportPanel({ drivers, settings, getIdToken, onSaveEventName, onClose }: ReportPanelProps) {
  // Stages that have at least one result; default to the latest.
  const stagesWithResults = useMemo(
    () => Array.from({ length: 12 }, (_, i) => i + 1).filter(s => drivers.some(d => !d.isHidden && d.stageTimes?.[String(s)] !== undefined)),
    [drivers]
  );
  const [stage, setStage] = useState<number>(stagesWithResults[stagesWithResults.length - 1] ?? 1);
  const [eventName, setEventName] = useState(settings.eventName ?? '');
  const [format, setFormat] = useState<ReportFormat>('summary');
  const [hashtags, setHashtags] = useState(true);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);

  // Re-check the draft live as the operator edits it, against the current results.
  const liveCheck = useMemo(() => {
    if (!result) return null;
    if (draft === result.draft) return { ok: result.verified, checked: result.checked, issues: result.issues };
    return verifyDraft(draft, buildFactSheet(drivers, settings, stage, eventName));
  }, [draft, result, drivers, settings, stage, eventName]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    if (eventName.trim() !== (settings.eventName ?? '')) onSaveEventName(eventName.trim());
    try {
      const token = await getIdToken();
      if (!token) {
        setError(REPORT_ERRORS.UNAUTHENTICATED);
        return;
      }
      const res = await fetch('/api/stage-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stage, format, notes, eventName: eventName.trim(), hashtags }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setError(body?.message ?? `The report service returned an error (${res.status}). Try again.`);
        return;
      }
      setResult(body as ReportResponse);
      setDraft((body as ReportResponse).draft);
    } catch {
      setError("Can't reach the report service. Check your internet connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
    } catch {
      // Fallback for browsers without clipboard permission.
      const ta = document.createElement('textarea');
      ta.value = draft;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const noResults = stagesWithResults.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} className="absolute inset-0 bg-black/80 backdrop-blur-xs" />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        role="dialog"
        aria-label="Stage report writer"
        className="relative w-full sm:max-w-2xl sm:max-h-[90vh] bg-(--bg-panel) border border-(--line) flex flex-col font-mono z-10"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--line) bg-(--bg-header) shrink-0">
          <p className="text-[11px] text-(--accent) uppercase font-black tracking-widest flex items-center gap-2">
            <FileText size={14} /> Stage Report Writer
          </p>
          <button onClick={onClose} className="p-1 text-(--text-secondary) hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
          {noResults ? (
            <p className="text-xs text-(--text-secondary)">{REPORT_ERRORS.NO_RESULTS}</p>
          ) : (
            <>
              {/* Options */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className={label}>Stage</label>
                  <select value={stage} onChange={e => setStage(Number(e.target.value))} className={`${input} appearance-none`}>
                    {stagesWithResults.map(s => <option key={s} value={s}>SS {s}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={label}>Event name</label>
                  <input value={eventName} maxLength={MAX_EVENT_NAME_LENGTH} onChange={e => setEventName(e.target.value)} placeholder="e.g. Cebu Rally 2026" className={input} />
                </div>
              </div>

              <div className="space-y-1">
                <label className={label}>Format</label>
                <div className="flex flex-wrap items-center gap-2">
                  {(Object.keys(REPORT_FORMATS) as ReportFormat[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`text-[10px] px-3 py-1.5 border uppercase font-bold transition-all ${format === f ? 'bg-(--accent) text-black border-(--accent)' : 'text-(--text-secondary) border-(--line) hover:text-white'}`}
                    >
                      {REPORT_FORMATS[f].label}
                    </button>
                  ))}
                  {format === 'social' && (
                    <label className="flex items-center gap-1.5 text-[10px] text-(--text-secondary) font-bold uppercase ml-1 cursor-pointer">
                      <input type="checkbox" checked={hashtags} onChange={e => setHashtags(e.target.checked)} className="accent-(--accent)" />
                      Hashtags
                    </label>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className={label}>Notes (optional)</label>
                <textarea
                  value={notes}
                  maxLength={MAX_NOTES_LENGTH}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Context the times can't show, e.g. “car 7 puncture at km 4”, “rain from SS3”. These are the only non-timing facts the writer may use."
                  className={`${input} font-normal resize-y`}
                />
              </div>

              <button
                onClick={generate}
                disabled={loading}
                className="w-full h-10 bg-(--accent) hover:bg-white text-black font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-[10px]"
              >
                {loading ? <Activity size={14} className="animate-spin" /> : result ? <RefreshCw size={14} /> : <FileText size={14} />}
                {loading ? 'Writing & checking numbers…' : result ? 'Regenerate' : 'Generate report'}
              </button>

              {error && (
                <p className="text-[10px] font-mono text-red-400 uppercase leading-tight bg-red-500/10 p-2 border border-red-500/20">[FAULT]: {error}</p>
              )}

              {/* Draft */}
              {result && liveCheck && !loading && (
                <div className="space-y-2">
                  {liveCheck.ok ? (
                    <p className="flex items-start gap-2 text-[10px] font-bold uppercase leading-snug text-(--accent-ready) bg-(--accent-ready)/10 border border-(--accent-ready)/30 p-2">
                      <ShieldCheck size={14} className="shrink-0" />
                      Verified: all {liveCheck.checked} times, gaps, positions and car/crew pairings match the results.
                    </p>
                  ) : (
                    <div className="text-[10px] leading-snug text-amber-300 bg-amber-500/10 border border-amber-500/40 p-2 space-y-1.5">
                      <p className="flex items-start gap-2 font-black uppercase">
                        <AlertTriangle size={14} className="shrink-0" />
                        Not verified: {liveCheck.issues.length === 1 ? "1 item below doesn't" : `${liveCheck.issues.length} items below don't`} match the results. Fix or remove {liveCheck.issues.length === 1 ? 'it' : 'them'} before posting.
                      </p>
                      <ul className="list-disc pl-6 font-bold normal-case">
                        {liveCheck.issues.map((i, n) => <li key={n}><span className="text-red-300">“{i.text}”</span>: {i.message}</li>)}
                      </ul>
                      <div className="bg-(--bg-deep) border border-(--line) p-2 mt-1">
                        <Highlighted text={draft} issues={liveCheck.issues} />
                      </div>
                    </div>
                  )}
                  {result.provisional && (
                    <p className="text-[10px] font-bold uppercase text-amber-300">Provisional: some crews had no {result.stageLabel} result yet.</p>
                  )}
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    rows={10}
                    aria-label="Report draft"
                    className="w-full bg-(--bg-deep) border border-(--line) text-(--text-primary) p-3 focus:border-(--accent) focus:outline-none text-xs leading-relaxed font-sans resize-y"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[9px] uppercase text-(--text-subtle) font-bold">
                      {draft !== result.draft ? 'Edited · re-checked as you type' : `${result.attempts === 2 ? 'Rewritten once after the number check · ' : ''}${result.model}`}
                    </span>
                    <button
                      onClick={copy}
                      className="shrink-0 flex items-center gap-1.5 px-4 py-2 border border-(--accent) text-(--accent) hover:bg-(--accent) hover:text-black text-[10px] font-black uppercase tracking-widest transition-colors"
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
