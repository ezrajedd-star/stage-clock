/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc,
  query, 
  orderBy, 
  serverTimestamp, 
  getDoc,
  getDocs,
  writeBatch,
  deleteField
} from 'firebase/firestore';
import { db, auth, signIn, handleFirestoreError } from './services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Driver, OperationType, Settings } from './types';
import { timeToSeconds, calculateTotalTime } from './lib/rallyUtils';
import InputConsole from './components/InputConsole';
import ReportPanel from './components/ReportPanel';
import ShareModal from './components/ShareModal';
import ResetEventDialog from './components/ResetEventDialog';
import CloseLegDialog from './components/CloseLegDialog';
import type { ParxLeg } from './lib/parxConfig';
import { MasterEntryList, ClassStandings } from './components/ResultsDisplay';
import { motion } from 'motion/react';
import { Activity, LogIn, Trophy, Timer, Shield, Settings as SettingsIcon, QrCode, RotateCcw, Flag, Lock, Unlock, Send } from 'lucide-react';

// Must match the admin email in firestore.rules.
const ADMIN_EMAIL = 'ezrajedd@gmail.com';

// PARX Open website (leg list + "View on PARX Open" links). Set VITE_PARX_SITE_URL in Vercel.
const PARX_SITE_URL = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_PARX_SITE_URL ?? '').replace(/\/$/, '');

export default function App() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [settings, setSettings] = useState<Settings>({ dnfPenalty: 60 });
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [isOperator, setIsOperator] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [showCloseLeg, setShowCloseLeg] = useState(false);
  const [publishState, setPublishState] = useState<{ busy: boolean; error: string | null; done: boolean }>({ busy: false, error: null, done: false });
  // While a leg is closed (published to PARX Open) the board is locked.
  const isClosed = !!settings.closedAt;
  // Only the admin can wipe the event (the reset button is not shown to other operators).
  const isAdmin = !!user?.emailVerified && user.email?.toLowerCase() === ADMIN_EMAIL;

  // Operators (admin or listed in /operators) get the input terminal and row controls.
  useEffect(() => {
    const email = user?.email?.toLowerCase();
    if (!user || !email || !user.emailVerified) {
      setIsOperator(false);
      return;
    }
    if (email === ADMIN_EMAIL) {
      setIsOperator(true);
      return;
    }
    let active = true;
    getDoc(doc(db, 'operators', email))
      .then(snap => { if (active) setIsOperator(snap.exists()); })
      .catch(() => { if (active) setIsOperator(false); });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });

    const driversQuery = query(collection(db, 'drivers'), orderBy('totalTimeSeconds', 'asc'));
    const unsubscribeDrivers = onSnapshot(driversQuery, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Driver));
      setDrivers(docs);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'drivers');
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setSettings({
          dnfPenalty: data.dnfPenalty ?? 60,
          dnfCalculationMethod: data.dnfCalculationMethod ?? 'class',
          eventName: typeof data.eventName === 'string' ? data.eventName : undefined,
          parxLegSlug: typeof data.parxLegSlug === 'string' ? data.parxLegSlug : undefined,
          closedAt: typeof data.closedAt === 'string' ? data.closedAt : undefined,
          closedBy: typeof data.closedBy === 'string' ? data.closedBy : undefined,
        });
      } else if (user) {
        // Init default settings if they don't exist, only if user is signed in
        setDoc(doc(db, 'settings', 'global'), { dnfPenalty: 60, dnfCalculationMethod: 'class' }).catch(err => {
          handleFirestoreError(err, OperationType.WRITE, 'settings/global');
        });
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'settings/global');
    });

    return () => {
      unsubscribeAuth();
      unsubscribeDrivers();
      unsubscribeSettings();
    };
  }, []);

  const handleUpdateSettings = async (newSettings: Partial<Settings>) => {
    try {
      await setDoc(doc(db, 'settings', 'global'), newSettings, { merge: true });
    } catch (err: any) {
      setError(err.message);
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
    }
  };

  const handleToggleHidden = async (driverId: string, currentState: boolean) => {
    if (!user) return;
    try {
      const driverRef = doc(db, 'drivers', driverId);
      await setDoc(driverRef, { 
        isHidden: !currentState,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err: any) {
      setError(err.message);
      handleFirestoreError(err, OperationType.WRITE, `drivers/${driverId}`);
    }
  };

  // Saves only the CAR (vehicle) of an existing entry, without touching its times.
  const handleUpdateCarModel = async (driverId: string, carModel: string) => {
    if (!user) return;
    setProcessing(true);
    setError(null);
    try {
      await setDoc(doc(db, 'drivers', driverId), { carModel: carModel.trim(), updatedAt: serverTimestamp() }, { merge: true });
    } catch (err: any) {
      setError(err.message);
      handleFirestoreError(err, OperationType.WRITE, `drivers/${driverId}`);
    } finally {
      setProcessing(false);
    }
  };

  // Starts a new event: deletes every driver entry (times, penalties, DNF/DNS) and clears
  // the event name. Operators and the DNF settings are kept. Errors go back to the dialog.
  const handleResetEvent = async () => {
    const snapshot = await getDocs(collection(db, 'drivers'));
    // Firestore batches hold at most 500 writes.
    for (let i = 0; i < snapshot.docs.length; i += 400) {
      const batch = writeBatch(db);
      snapshot.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await setDoc(doc(db, 'settings', 'global'), { eventName: deleteField(), parxLegSlug: deleteField(), closedAt: deleteField(), closedBy: deleteField() }, { merge: true });
    setError(null);
  };

  // ---- PARX Open: close the leg and publish the final results ----------------------------
  // Asks the server (admin only) to start the PARX Open import for the leg. Throws a readable message.
  const publishToParx = async (legSlug: string): Promise<{ actionsUrl?: string }> => {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    if (!token) throw new Error('Sign in again to publish.');
    let res: Response;
    try {
      res = await fetch('/api/close-leg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ leg: legSlug }),
      });
    } catch {
      throw new Error('Could not reach the server. Check the connection and tap “Retry publish”.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? `Publishing failed (${res.status}).`);
    return { actionsUrl: body.actionsUrl };
  };

  // Marks the leg closed first (so the board locks even if publishing fails), then publishes.
  const handleCloseLeg = async (leg: ParxLeg) => {
    await setDoc(doc(db, 'settings', 'global'), {
      parxLegSlug: leg.slug,
      closedAt: new Date().toISOString(),
      closedBy: user?.email?.toLowerCase() ?? '',
    }, { merge: true });
    try {
      const r = await publishToParx(leg.slug);
      setPublishState({ busy: false, error: null, done: true });
      return r;
    } catch (err: any) {
      setPublishState({ busy: false, error: err.message, done: false });
      throw err;
    }
  };

  const handleRetryPublish = async () => {
    if (!settings.parxLegSlug) return;
    setPublishState({ busy: true, error: null, done: false });
    try {
      await publishToParx(settings.parxLegSlug);
      setPublishState({ busy: false, error: null, done: true });
    } catch (err: any) {
      setPublishState({ busy: false, error: err.message, done: false });
    }
  };

  // Reopens the board to correct a time. Closing again republishes (the PARX results are replaced).
  const handleReopenLeg = async () => {
    if (!window.confirm('Reopen this leg? The board unlocks for corrections. Close it again to republish the results to PARX Open.')) return;
    await handleUpdateSettings({ closedAt: deleteField() as unknown as string, closedBy: deleteField() as unknown as string });
    setPublishState({ busy: false, error: null, done: false });
  };

  // Drops (or restores) one stage run of an entry: a dropped run stays on the board but
  // does not count towards that crew's total.
  const handleToggleDropRun = async (driverId: string, stageKey: string, drop: boolean) => {
    if (!user) return;
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) return;
    setProcessing(true);
    setError(null);
    try {
      const current = driver.droppedStages ?? [];
      const droppedStages = drop
        ? Array.from(new Set([...current, stageKey])).sort((a, b) => Number(a) - Number(b))
        : current.filter(k => k !== stageKey);
      await setDoc(doc(db, 'drivers', driverId), {
        droppedStages,
        totalTimeSeconds: calculateTotalTime(driver.stageTimes, driver.stagePenalties, droppedStages),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err: any) {
      setError(err.message);
      handleFirestoreError(err, OperationType.WRITE, `drivers/${driverId}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteDriver = async (driverId: string) => {
    if (!user) return;
    setProcessing(true);
    setError(null);
    try {
      const driverRef = doc(db, 'drivers', driverId);
      await deleteDoc(driverRef);
    } catch (err: any) {
      setError(err.message);
      handleFirestoreError(err, OperationType.DELETE, `drivers/${driverId}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleUpdate = async (updateData: {
    driverName: string;
    carNumber: string;
    carClass: string;
    carModel: string;
    ssNum: string;
    recordedTime: string;
    penaltySec: number;
  }) => {
    setProcessing(true);
    setError(null);
    try {
      const driverName = updateData.driverName.trim();
      const carNumber = updateData.carNumber.trim().toUpperCase();
      const carClass = updateData.carClass.trim().toUpperCase();
      const carModel = updateData.carModel.trim();
      const { ssNum, recordedTime, penaltySec } = updateData;
      
      const ssIndex = ssNum.replace("SS", "");
      let timeSec: number;
      
      if (recordedTime === "DNF") {
        timeSec = -1;
      } else if (recordedTime === "DNS") {
        timeSec = -2;
      } else {
        timeSec = timeToSeconds(recordedTime);
      }

      const driverId = `driver_${carNumber}_${carClass.replace(/\s+/g, '_')}`;
      const driverRef = doc(db, 'drivers', driverId);
      
      const existingDoc = await getDoc(driverRef);
      let driverData: any;

      if (existingDoc.exists()) {
        const data = existingDoc.data() as Driver;
        const newStageTimes = { ...data.stageTimes, [ssIndex]: timeSec };
        const newStagePenalties = { ...data.stagePenalties, [ssIndex]: penaltySec };
        const droppedStages = data.droppedStages ?? [];
        const newTotal = calculateTotalTime(newStageTimes, newStagePenalties, droppedStages);
        
        driverData = {
          name: driverName,
          carNumber: data.carNumber,
          carModel: carModel || data.carModel || '',
          class: data.class,
          stageTimes: newStageTimes,
          stagePenalties: newStagePenalties,
          droppedStages,
          totalTimeSeconds: newTotal,
          isHidden: data.isHidden || false,
          updatedAt: serverTimestamp()
        };
      } else {
        const stageTimes = { [ssIndex]: timeSec };
        const stagePenalties = { [ssIndex]: penaltySec };
        const total = calculateTotalTime(stageTimes, stagePenalties);
        
        driverData = {
          name: driverName,
          carNumber: carNumber,
          carModel,
          class: carClass,
          stageTimes,
          stagePenalties,
          totalTimeSeconds: total,
          isHidden: false,
          updatedAt: serverTimestamp()
        };
      }

      await setDoc(driverRef, driverData);
    } catch (err: any) {
      setError(err.message);
      if (err.message?.toLowerCase().includes('permission') || err.code === 'permission-denied') {
        const carNum = updateData.carNumber.trim();
        const carClass = updateData.carClass.trim();
        handleFirestoreError(err, OperationType.WRITE, `drivers/driver_${carNum}_${carClass}`);
      }
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-(--bg-deep) flex items-center justify-center font-mono flex-col gap-4 text-(--text-primary)">
        <Activity className="animate-spin text-(--accent)" size={32} />
        <p className="text-(--text-secondary) uppercase tracking-widest text-[10px]">Initializing Rally Engine...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen md:h-screen flex flex-col md:overflow-hidden border-2 md:border-4 border-(--bg-darker) bg-(--bg-deep) text-(--text-primary)">
      {/* Header */}
      <header className="h-14 md:h-16 bg-(--bg-header) border-b border-(--line) flex items-center justify-between gap-3 px-3 md:px-8 shadow-2xl relative z-10 shrink-0">
        <div className="flex items-center gap-3 md:gap-6 min-w-0">
            <div className="w-9 h-9 md:w-12 md:h-12 shrink-0 bg-(--accent) flex items-center justify-center rounded-sm skew-x-[-12deg] group relative overflow-hidden">
             <svg viewBox="0 0 24 24" className="w-7 h-7 md:w-9 md:h-9 text-black skew-x-[12deg] fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               {/* Tire Outer */}
               <circle cx="12" cy="12" r="9" />
               {/* Tire Inner Rim */}
               <circle cx="12" cy="12" r="5" />
               {/* Hub */}
               <circle cx="12" cy="12" r="1.5" fill="currentColor" />
               {/* Gravel Treads */}
               <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
               <path d="M18.36 5.64l-1.41 1.41M7.05 16.95l-1.41 1.41M18.36 18.36l-1.41-1.41M7.05 7.05l-1.41 1.41" />
               {/* Extra tread detail */}
               <path d="M15 3.5l-.5 1.5M9 3.5l.5 1.5M15 20.5l-.5-1.5M9 20.5l.5-1.5M3.5 15l1.5-.5M3.5 9l1.5.5M20.5 15l-1.5-.5M20.5 9l-1.5.5" opacity="0.6" />
             </svg>
           </div>
           <div>
             <h1 className="text-lg md:text-2xl whitespace-nowrap font-black tracking-tighter text-white uppercase leading-none mb-1">
               Stage <span className="text-(--accent)">Clock</span>
             </h1>
             <p className="hidden sm:block text-[10px] text-(--text-secondary) tracking-[0.2em] uppercase font-mono">
               Rally Timing Engine by Ezra Decena
             </p>
           </div>
        </div>

        <div className="flex items-center gap-3 md:gap-8 text-right shrink-0">
          <button
            onClick={() => setShowShare(true)}
            className="flex items-center gap-1.5 border border-(--line) hover:border-(--accent) text-white hover:text-(--accent) px-2 md:px-3 py-1.5 font-mono text-[10px] font-black uppercase tracking-widest transition-colors"
            aria-label="Share Stage Clock with a QR code"
          >
            <QrCode size={14} /> <span>Share</span>
          </button>
          <div className="hidden md:flex border-r border-(--line) pr-8 items-center gap-3">
            <div>
              <p className="text-[10px] text-(--text-secondary) uppercase mb-1">Status</p>
              <p className="text-lg font-mono text-(--accent) font-bold">{isClosed ? `FINAL${settings.parxLegSlug ? ` · ${settings.parxLegSlug.toUpperCase()}` : ''}` : 'LIVE FEED'}</p>
            </div>
            {isClosed
              ? <Lock size={14} className="text-(--accent)" aria-label="Leg closed" />
              : <div className="w-2.5 h-2.5 rounded-full bg-(--accent-ready) animate-pulse shadow-[0_0_10px_var(--accent-ready)]" />}
          </div>
          <div>
            {!user ? (
              <button 
                onClick={signIn}
                className="bg-(--accent) text-black px-3 md:px-4 py-1.5 font-mono text-[10px] font-black uppercase tracking-widest hover:bg-white transition-colors skew-x-[-12deg]"
              >
                <span className="inline-block skew-x-[12deg]">Auth Required</span>
              </button>
            ) : (
              <div className="text-right">
                <p className="text-[9px] md:text-[10px] text-(--text-secondary) uppercase mb-0.5 md:mb-1">{isOperator ? 'Operator' : 'View Only'}</p>
                <p className="text-sm md:text-lg font-mono text-white max-w-[110px] md:max-w-[150px] truncate">{user.email?.split('@')[0]}</p>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex flex-col md:flex-row md:overflow-hidden p-1 bg-(--bg-darker) gap-1">
        <div className="flex-1 min-w-0 flex flex-col md:overflow-hidden">
          {/* Main List Area */}
          <section className="flex-1 bg-(--bg-panel) border border-(--line) flex flex-col md:overflow-hidden">
            <div className="flex-1 overflow-auto custom-scrollbar p-0">
              <MasterEntryList 
                drivers={drivers} 
                settings={settings}
                showHidden={showHidden}
                onToggleShowHidden={() => setShowHidden(!showHidden)}
                onToggleHidden={isOperator && !isClosed ? handleToggleHidden : undefined}
                onDeleteDriver={isOperator && !isClosed ? handleDeleteDriver : undefined}
                onOpenReport={isOperator ? () => setShowReport(true) : undefined}
              />
            </div>
          </section>
        </div>

        {/* Right Sidebar: Input Terminal */}
        {user && isOperator && (
          <aside className="order-first md:order-none w-full md:w-80 shrink-0 bg-(--bg-panel) border border-(--line) flex flex-col md:overflow-hidden">
            <div className="p-3 border-b border-(--line) bg-(--bg-header) flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-(--accent) uppercase font-black tracking-widest flex items-center gap-2">
                  <Activity size={12} /> Input Terminal
                </p>
                <div className="w-1.5 h-1.5 rounded-full bg-(--accent-ready) animate-pulse shadow-[0_0_8px_var(--accent-ready)]" />
              </div>
              {error && (
                <span className="text-[9px] font-mono text-red-500 uppercase leading-tight bg-red-500/10 p-2 border border-red-500/20">
                  [FAULT]: {error}
                </span>
              )}
            </div>
            
            <div className="flex-1 md:overflow-y-auto custom-scrollbar">
              {isClosed ? (
                <div className="p-3 space-y-3 font-mono">
                  <div className="border border-(--accent)/40 bg-(--accent)/5 p-3 space-y-1.5">
                    <p className="text-[10px] text-(--accent) uppercase font-black tracking-widest flex items-center gap-1.5"><Lock size={11} /> Leg closed</p>
                    <p className="text-[11px] text-white leading-relaxed">
                      {settings.parxLegSlug ? `Published to PARX Open as “${settings.parxLegSlug}”.` : 'Closed.'} The board is locked.
                    </p>
                    <p className="text-[10px] text-(--text-secondary)">
                      {new Date(settings.closedAt!).toLocaleString()}{settings.closedBy ? ` · ${settings.closedBy.split('@')[0]}` : ''}
                    </p>
                    {publishState.done && <p className="text-[10px] text-(--accent-ready) uppercase">Publish request sent — results on PARX Open in about 2 minutes.</p>}
                    {publishState.error && <p className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 p-2">{publishState.error}</p>}
                    {PARX_SITE_URL && settings.parxLegSlug && (
                      <a href={`${PARX_SITE_URL}/results/${settings.parxLegSlug}`} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-(--accent) underline uppercase tracking-widest">View on PARX Open</a>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={handleRetryPublish}
                        disabled={publishState.busy || !settings.parxLegSlug}
                        className="h-8 flex items-center justify-center gap-1.5 border border-(--line) text-(--text-secondary) hover:text-white hover:border-white font-mono uppercase font-black text-[9px] tracking-widest transition-colors disabled:opacity-40"
                      >
                        <Send size={11} /> {publishState.busy ? 'Publishing…' : 'Retry publish'}
                      </button>
                      <button
                        onClick={() => { handleReopenLeg().catch(() => {}); }}
                        className="h-8 flex items-center justify-center gap-1.5 border border-(--line) text-(--text-secondary) hover:text-white hover:border-white font-mono uppercase font-black text-[9px] tracking-widest transition-colors"
                      >
                        <Unlock size={11} /> Reopen leg
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <InputConsole 
                  onUpdate={handleUpdate} 
                  onUpdateCarModel={handleUpdateCarModel}
                  onToggleDropRun={handleToggleDropRun}
                  isLoading={processing} 
                  drivers={drivers}
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                />
              )}
              {isAdmin && !isClosed && (
                <div className="px-3 pb-2">
                  <button
                    onClick={() => setShowCloseLeg(true)}
                    className="w-full h-9 flex items-center justify-center gap-1.5 bg-(--accent) text-black hover:bg-white font-mono uppercase font-black text-[10px] tracking-widest transition-colors"
                  >
                    <Flag size={12} /> Close leg &amp; publish to PARX Open
                  </button>
                </div>
              )}
              {isAdmin && (
                <div className="px-3 pb-3">
                  <button
                    onClick={() => setShowReset(true)}
                    className="w-full h-8 flex items-center justify-center gap-1.5 border border-red-500/40 text-red-400/80 hover:text-red-400 hover:border-red-500 hover:bg-red-500/10 font-mono uppercase font-black text-[9px] tracking-widest transition-colors"
                  >
                    <RotateCcw size={11} /> Reset event data
                  </button>
                </div>
              )}
            </div>
          </aside>
        )}
      </main>

      {showShare && <ShareModal onClose={() => setShowShare(false)} />}

      {isAdmin && showCloseLeg && (
        <CloseLegDialog drivers={drivers} parxSiteUrl={PARX_SITE_URL} onConfirm={handleCloseLeg} onClose={() => setShowCloseLeg(false)} />
      )}

      {isAdmin && showReset && (
        <ResetEventDialog drivers={drivers} settings={settings} onConfirm={handleResetEvent} onClose={() => setShowReset(false)} />
      )}

      {/* Stage Report Writer (operators only) */}
      {user && isOperator && showReport && (
        <ReportPanel
          drivers={drivers}
          settings={settings}
          getIdToken={async () => (auth.currentUser ? auth.currentUser.getIdToken() : null)}
          onSaveEventName={name => { handleUpdateSettings({ eventName: name }).catch(() => { /* shown via the [FAULT] message */ }); }}
          onClose={() => setShowReport(false)}
        />
      )}

      {/* Footer */}
      <footer className="min-h-10 py-2 md:py-0 bg-(--bg-deep) border-t border-(--line) px-3 md:px-6 flex items-center justify-between text-[9px] md:text-[10px] text-(--text-subtle) uppercase tracking-widest font-bold shrink-0">
        <div>
          System: <span className="text-(--accent-ready)">Running</span> • 
          Data: <span className="text-(--accent-ready)">Online</span>
        </div>
        <div className="hidden sm:block">
          Stage Clock Official Timing Engine v4.2
        </div>
      </footer>
    </div>
  );
}
