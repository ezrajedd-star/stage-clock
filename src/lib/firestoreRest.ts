/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Driver, Settings } from '../types';

// Decoders for Firestore REST API documents. The report endpoint reads results
// straight from Firestore (public read) so the browser can't supply altered data.

type RestValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  mapValue?: { fields?: Record<string, RestValue> };
  arrayValue?: { values?: RestValue[] };
};

export interface RestDocument {
  name: string;
  fields?: Record<string, RestValue>;
}

export function decodeValue(v: RestValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.mapValue !== undefined) return decodeFields(v.mapValue.fields ?? {});
  if (v.arrayValue !== undefined) return (v.arrayValue.values ?? []).map(decodeValue);
  return null;
}

export function decodeFields(fields: Record<string, RestValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

export function decodeDriver(doc: RestDocument): Driver {
  const data = decodeFields(doc.fields ?? {});
  const id = doc.name.split('/').pop() as string;
  return {
    id,
    name: String(data.name ?? ''),
    carNumber: String(data.carNumber ?? ''),
    class: String(data.class ?? ''),
    stageTimes: (data.stageTimes as Record<string, number>) ?? {},
    stagePenalties: (data.stagePenalties as Record<string, number>) ?? {},
    totalTimeSeconds: Number(data.totalTimeSeconds ?? 0),
    isHidden: Boolean(data.isHidden),
    updatedAt: data.updatedAt ?? null,
  };
}

export function decodeSettings(doc: RestDocument | null): Settings {
  const data = doc ? decodeFields(doc.fields ?? {}) : {};
  return {
    dnfPenalty: typeof data.dnfPenalty === 'number' ? data.dnfPenalty : 60,
    dnfCalculationMethod: data.dnfCalculationMethod === 'overall' ? 'overall' : 'class',
    eventName: typeof data.eventName === 'string' ? data.eventName : undefined,
  };
}
