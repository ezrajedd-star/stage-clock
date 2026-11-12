/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Send, UserPlus, Hash, Layers, PlayCircle, ShieldAlert, Car, Save, Ban, Undo2 } from 'lucide-react';
import { secondsToTime } from '../lib/rallyUtils';
import { Driver, Settings } from '../types';

interface InputConsoleProps {
  onUpdate: (data: {
    driverName: string;
    carNumber: string;
    carClass: string;
    carModel: string;
    ssNum: string;
    recordedTime: string;
    penaltySec: number;
  }) => void;
  onUpdateCarModel: (driverId: string, carModel: string) => void;
  onToggleDropRun: (driverId: string, stageKey: string, drop: boolean) => void;
  isLoading: boolean;
  drivers: Driver[];
  settings: Settings;
  onUpdateSettings: (s: Partial<Settings>) => void;
}

const norm = (v: string) => v.trim().toUpperCase();

export default function InputConsole({ onUpdate, onUpdateCarModel, onToggleDropRun, isLoading, drivers, settings, onUpdateSettings }: InputConsoleProps) {
  const [driverName, setDriverName] = useState("");
  const [carNumber, setCarNumber] = useState("");
  const [carClass, setCarClass] = useState("");
  const [carModel, setCarModel] = useState("");
  // True once the operator types in the Car field: suggestions never overwrite their input.
  const [carTouched, setCarTouched] = useState(false);
  const [ssNum, setSsNum] = useState("1");
  const [recordedTime, setRecordedTime] = useState("");
  const [penaltySec, setPenaltySec] = useState(0);
  const [isDnfDns, setIsDnfDns] = useState(false);
  const [dnfDnsType, setDnfDnsType] = useState<"DNF" | "DNS">("DNF");

  const uniqueDrivers = useMemo(() => {
    const map = new Map<string, Driver>();
    drivers.forEach(d => {
      if (!map.has(d.carNumber)) {
        map.set(d.carNumber, d);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.carNumber.localeCompare(b.carNumber, undefined, { numeric: true }));
  }, [drivers]);
  
  const handleCarNumberSelect = (value: string) => {
    // If selecting from datalist, it might be "Num - Name". 
    // We extract the number part.
    const number = value.includes(" - ") ? value.split(" - ")[0] : value;
    setCarNumber(number);
    setCarTouched(false);
    
    const existing = drivers.find(d => norm(d.carNumber) === norm(number));
    if (existing) {
      setDriverName(existing.name);
      setCarClass(existing.class);
      setCarModel(existing.carModel ?? "");
    } else {
      setCarModel(""); // don't carry another entry's car over to a new one
    }
  };

  // The entry this form points at (same car number and class), if it already exists.
  const currentEntry = drivers.find(d => norm(d.carNumber) === norm(carNumber) && norm(d.class) === norm(carClass));

  // Once car #, class and driver name are filled in, suggest the car from an existing row:
  // the same entry first, then the same car number and driver in another class, then the same driver.
  const suggestion = useMemo(() => {
    const name = norm(driverName);
    if (!norm(carNumber) || !norm(carClass) || !name) return null;
    const withCar = drivers.filter(d => d.carModel?.trim());
    const found =
      withCar.find(d => norm(d.carNumber) === norm(carNumber) && norm(d.class) === norm(carClass)) ??
      withCar.find(d => norm(d.carNumber) === norm(carNumber) && norm(d.name) === name) ??
      withCar.find(d => norm(d.name) === name);
    return found ? { car: found.carModel!.trim(), from: found } : null;
  }, [drivers, carNumber, carClass, driverName]);

  const lastSuggested = useRef<string | null>(null);
  useEffect(() => {
    if (carTouched) return;
    if (suggestion) {
      setCarModel(suggestion.car);
      lastSuggested.current = suggestion.car;
    } else if (lastSuggested.current !== null) {
      // The details no longer match that row: take the suggestion back out.
      const previous = lastSuggested.current;
      setCarModel(c => (c === previous ? "" : c));
      lastSuggested.current = null;
    }
  }, [suggestion, carTouched]);
  const showSuggestion = !!suggestion && !carTouched && carModel === suggestion.car;

  // Drop run: only for an existing entry that has a result on the selected stage.
  const stageResult = currentEntry?.stageTimes?.[ssNum];
  const stageDropped = !!currentEntry?.droppedStages?.includes(ssNum);
  const carModelChanged = !!currentEntry && carModel.trim() !== (currentEntry.carModel ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!driverName || !carNumber || !carClass || isLoading) return;
    if (!isDnfDns && !recordedTime) return;
    
    onUpdate({
      driverName: driverName.trim(),
      carNumber: carNumber.trim().toUpperCase(),
      carClass: carClass.trim().toUpperCase(),
      carModel: carModel.trim(),
      ssNum: `SS${ssNum}`,
      recordedTime: isDnfDns ? dnfDnsType : recordedTime,
      penaltySec
    });

    // Reset some fields
    setRecordedTime("");
    setPenaltySec(0);
    setIsDnfDns(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full font-mono text-[10px] p-3 gap-3">
      <div className="space-y-3">
        {/* Row 1: Car # and Class */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-(--text-secondary) flex items-center gap-1.5 uppercase font-black text-[8px] tracking-wider">
              <Hash size={10} className="text-(--accent)" /> Car #
            </label>
            <input
              list="car-numbers-list"
              value={carNumber}
              onChange={(e) => handleCarNumberSelect(e.target.value)}
              className="w-full bg-(--bg-deep) border border-(--line) text-white px-2 py-1.5 focus:border-(--accent) focus:outline-none uppercase text-sm font-black"
              placeholder="#"
              required
            />
            <datalist id="car-numbers-list">
              {uniqueDrivers.map(d => (
                <option key={d.id} value={`${d.carNumber} - ${d.name}`} />
              ))}
            </datalist>
          </div>

          <div className="space-y-1">
            <label className="text-(--text-secondary) flex items-center gap-1.5 uppercase font-black text-[8px] tracking-wider">
              <Layers size={10} className="text-(--accent)" /> Class
            </label>
            <input
              type="text"
              value={carClass}
              onChange={(e) => setCarClass(e.target.value)}
              className="w-full bg-(--bg-deep) border border-(--line) text-white px-2 py-1.5 focus:border-(--accent) focus:outline-none uppercase font-bold text-xs"
              placeholder="Class"
              required
            />
          </div>
        </div>

        {/* Row 2: Driver Name */}
        <div className="space-y-1">
          <label className="text-(--text-secondary) flex items-center gap-1.5 uppercase font-black text-[8px] tracking-wider">
            <UserPlus size={10} className="text-(--accent)" /> Driver Name
          </label>
          <input
            type="text"
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            className="w-full bg-(--bg-deep) border border-(--line) text-white px-2 py-1.5 focus:border-(--accent) focus:outline-none uppercase font-bold text-xs"
            placeholder="Driver Name"
            required
          />
        </div>

        {/* Row 2b: Car (vehicle), optional */}
        <div className="space-y-1">
          <label className="text-(--text-secondary) flex items-center gap-1.5 uppercase font-black text-[8px] tracking-wider">
            <Car size={10} className="text-(--accent)" /> Car (optional)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={carModel}
              onChange={(e) => { setCarModel(e.target.value); setCarTouched(true); }}
              maxLength={60}
              className="flex-1 min-w-0 bg-(--bg-deep) border border-(--line) text-white px-2 py-1.5 focus:border-(--accent) focus:outline-none font-bold text-xs"
              placeholder="e.g. AWD Turbo Corolla"
            />
            {carModelChanged && (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => currentEntry && onUpdateCarModel(currentEntry.id, carModel)}
                className="shrink-0 flex items-center gap-1 px-2 border border-(--accent) text-(--accent) hover:bg-(--accent) hover:text-black uppercase font-black text-[8px] tracking-wider transition-colors disabled:opacity-50"
                title="Save the car without entering a stage time"
              >
                <Save size={10} /> Save car
              </button>
            )}
          </div>
          {showSuggestion && (
            <p className="text-[8px] text-(--text-subtle) uppercase font-bold tracking-wider">
              Suggested from #{suggestion!.from.carNumber} {suggestion!.from.name} ({suggestion!.from.class}) · type to change
            </p>
          )}
        </div>

        <div className="h-px bg-(--line)/10" />

        {/* Row 3: Stage and Mode */}
        <div className="grid grid-cols-2 gap-3 items-end">
          <div className="space-y-1">
            <label className="text-(--text-secondary) flex items-center gap-1.5 uppercase font-black text-[8px] tracking-wider">
              <PlayCircle size={10} className="text-(--accent)" /> Stage
            </label>
            <select
              value={ssNum}
              onChange={(e) => setSsNum(e.target.value)}
              className="w-full bg-(--bg-deep) border border-(--line) text-white px-2 py-1.5 focus:border-(--accent) focus:outline-none appearance-none font-bold text-xs"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>SS {n}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-[8px] text-(--text-secondary) cursor-pointer hover:text-white justify-end font-bold mb-2">
            <input 
              type="checkbox" 
              checked={isDnfDns} 
              onChange={(e) => setIsDnfDns(e.target.checked)}
              className="w-2.5 h-2.5 accent-(--accent)"
              id="dnf-dns-mode"
            />
            <label htmlFor="dnf-dns-mode" className="cursor-pointer">DNF/DNS</label>
          </div>
        </div>

        {/* Drop run: the selected stage of an existing entry */}
        {currentEntry && stageResult !== undefined && (
          <div className={`flex items-center justify-between gap-2 px-2 py-1.5 border ${stageDropped ? 'border-amber-500/40 bg-amber-500/5' : 'border-(--line)'}`}>
            <span className="text-[9px] uppercase font-bold text-(--text-secondary) leading-tight">
              SS{ssNum} run: <span className={stageDropped ? 'line-through text-(--text-subtle)' : 'text-white'}>{secondsToTime(stageResult)}</span>
              {stageDropped && <span className="text-amber-400"> · dropped, not in total</span>}
            </span>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => onToggleDropRun(currentEntry.id, ssNum, !stageDropped)}
              className={`shrink-0 flex items-center gap-1 px-2 py-1 border uppercase font-black text-[8px] tracking-wider transition-colors disabled:opacity-50 ${stageDropped ? 'border-white/40 text-white hover:bg-white hover:text-black' : 'border-amber-500 text-amber-400 hover:bg-amber-500 hover:text-black'}`}
              title={stageDropped ? 'Count this run in the total again' : 'Leave this run out of the total (it stays on the board)'}
            >
              {stageDropped ? <><Undo2 size={10} /> Restore run</> : <><Ban size={10} /> Drop run</>}
            </button>
          </div>
        )}

        {/* Conditional Sections based on DNF/DNS toggle */}
        {!isDnfDns ? (
          <>
            {/* Row 4: Time/Status Input (Valid Run) */}
            <div className="space-y-1">
              <label className="text-(--accent) flex items-center gap-1.5 uppercase font-black text-[8px] tracking-wider transition-colors">
                Time (MM:SS.SS)
              </label>
              <input
                type="text"
                value={recordedTime}
                onChange={(e) => setRecordedTime(e.target.value)}
                className="w-full bg-(--bg-deep) border border-(--line) text-(--accent) px-2 py-2 focus:border-white focus:outline-none font-black text-lg tracking-tight tabular-nums"
                placeholder="00:00.00"
                pattern="^(\d+:)?\d{2}:\d{2}(\.\d+)?$"
                required
              />
            </div>

            {/* Row 5: Penalty (Valid Run) */}
            <div className="space-y-1">
              <label className="text-red-400 flex items-center gap-1.5 uppercase font-black text-[8px] tracking-wider">
                <ShieldAlert size={10} /> Penalty (S)
              </label>
              <input
                type="number"
                min="0"
                value={penaltySec}
                onChange={(e) => setPenaltySec(parseInt(e.target.value) || 0)}
                className="w-full bg-(--bg-deep) border border-(--line) text-red-400 px-2 py-1.5 focus:border-red-500 focus:outline-none font-bold text-xs"
              />
            </div>
          </>
        ) : (
          <>
            {/* Row 4: Status (DNF/DNS Run) */}
            <div className="space-y-1">
              <label className="text-red-400 flex items-center gap-1.5 uppercase font-black text-[8px] tracking-wider transition-colors">
                Status
              </label>
              <select
                 value={dnfDnsType}
                 onChange={(e) => setDnfDnsType(e.target.value as "DNF" | "DNS")}
                 className="w-full bg-red-950/20 border border-red-900/50 text-red-400 px-2 py-2 focus:border-red-500 focus:outline-none font-black text-sm"
              >
                <option value="DNF">DNF (Did Not Finish)</option>
                <option value="DNS">DNS (Did Not Start)</option>
              </select>
            </div>

            {/* Row 5: DNF Sec+ and Calculation Base (DNF/DNS Run) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-(--accent) flex items-center gap-1.5 uppercase font-black text-[8px] tracking-wider">
                  <PlayCircle size={10} /> DNF Sec+
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings.dnfPenalty}
                  onChange={(e) => onUpdateSettings({ dnfPenalty: parseInt(e.target.value) || 0 })}
                  className="w-full bg-(--bg-deep) border border-(--line) text-(--accent) px-2 py-1.5 focus:border-(--accent) focus:outline-none font-bold text-xs"
                  title="Global DNF/DNS additional penalty (Slowest + X)"
                />
              </div>

              <div className="space-y-1">
                <label className="text-white/60 flex items-center gap-1.5 uppercase font-black text-[8px] tracking-wider">
                  <Layers size={10} /> Calculation Base
                </label>
                <select
                  value={settings.dnfCalculationMethod || 'class'}
                  onChange={(e) => onUpdateSettings({ dnfCalculationMethod: e.target.value as 'class' | 'overall' })}
                  className="w-full bg-(--bg-deep) border border-(--line) text-white px-2 py-1.5 focus:border-(--accent) focus:outline-none font-bold text-xs"
                >
                  <option value="class">Slowest in Class</option>
                  <option value="overall">Slowest Overall</option>
                </select>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-auto pt-2">
        <button
          type="submit"
          disabled={isLoading}
          className="w-full h-10 bg-(--accent) hover:bg-white text-black font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-[10px]"
        >
          <Send size={14} />
          {isLoading ? "TX..." : "SUBMIT DATA"}
        </button>
      </div>
    </form>
  );
}
