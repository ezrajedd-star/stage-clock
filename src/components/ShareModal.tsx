/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { motion } from 'motion/react';
import { X, QrCode, Copy, Check, Share2 } from 'lucide-react';

interface ShareModalProps {
  onClose: () => void;
}

// Shows a QR code of the site so people at the event can open Stage Clock by scanning
// someone else's screen. The code is generated in the browser; nothing is sent anywhere.
export default function ShareModal({ onClose }: ShareModalProps) {
  const url = `${window.location.origin}/`;
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    // Dark modules on white with a quiet zone: the most reliable for phone cameras.
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } })
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the link is shown as text to copy by hand */ }
  };

  const share = () => {
    navigator.share({ title: 'Stage Clock', text: 'Live rally results on Stage Clock', url }).catch(() => { /* dismissed */ });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} className="absolute inset-0 bg-black/85 backdrop-blur-xs" />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        role="dialog"
        aria-label="Share Stage Clock"
        className="relative w-full max-w-sm bg-(--bg-panel) border border-(--line) flex flex-col font-mono z-10"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--line) bg-(--bg-header)">
          <p className="text-[11px] text-(--accent) uppercase font-black tracking-widest flex items-center gap-2">
            <QrCode size={14} /> Share Stage Clock
          </p>
          <button onClick={onClose} className="p-1 text-(--text-secondary) hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 flex flex-col items-center gap-4">
          <p className="text-[11px] text-white font-bold uppercase tracking-wider text-center">Scan with your phone camera to open live results</p>
          <div className="w-full max-w-[280px] aspect-square bg-white p-2 rounded-sm">
            {svg ? (
              <div className="w-full h-full [&>svg]:w-full [&>svg]:h-full" role="img" aria-label={`QR code for ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-black text-[10px] uppercase font-bold">Generating…</div>
            )}
          </div>
          <p className="text-xs text-(--accent) font-bold break-all text-center select-all">{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</p>
          <div className="w-full grid grid-cols-2 gap-2">
            <button
              onClick={copy}
              className="h-10 flex items-center justify-center gap-2 border border-(--line) text-white hover:border-(--accent) hover:text-(--accent) uppercase font-black text-[10px] tracking-widest transition-colors"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy link'}
            </button>
            <button
              onClick={canShare ? share : copy}
              className="h-10 flex items-center justify-center gap-2 bg-(--accent) hover:bg-white text-black uppercase font-black text-[10px] tracking-widest transition-colors"
            >
              <Share2 size={14} /> Share
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
