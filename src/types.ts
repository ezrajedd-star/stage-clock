/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Driver {
  id: string;
  name: string;
  carNumber: string;
  class: string;
  stageTimes: Record<string, number>; // SS# -> seconds
  stagePenalties: Record<string, number>; // SS# -> seconds
  totalTimeSeconds: number;
  isHidden?: boolean;
  updatedAt: any; // Firestore Timestamp or request.time
}

export type RallyClass = string;

export interface Settings {
  dnfPenalty: number; // seconds to add to slowest class time
  dnfCalculationMethod?: 'class' | 'overall'; // choice between class and overall slowest time
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}
