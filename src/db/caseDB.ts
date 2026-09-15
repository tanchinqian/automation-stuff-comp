import type { CauseId, DefectId, SymptomId } from '../engine/types';

/**
 * 8D report fields captured with a case. Mirrors the server's `report_data`
 * object (snake_case on the wire) so a past case can repopulate the report
 * form from its own record instead of the browser's localStorage.
 */
export interface CaseReportData {
  employeeName?: string;
  employeeId?: string;
  machineId?: string;
  affectedCount?: string;
  d3Status?: string;
  d3Action?: string;
  d3CompletedBy?: string;
  d3CompletedAt?: string;
  d4Status?: string;
  d4Method?: string;
  d5Status?: string;
  d5TargetDate?: string;
  d5Responsible?: string;
  d6Status?: string;
  d6Action?: string;
  /** form field `d6Verified`, named for the server schema */
  d6VerifiedEffective?: string;
  notes?: string;
  confirmedCause?: string;
  closedBy?: string;
  closedDate?: string;
}

export interface CaseRecord {
  id?: number;
  timestamp: number;
  material: string;
  defectId: DefectId;
  symptoms: SymptomId[];
  topCause: CauseId;
  resolvedCause?: CauseId;
  notes?: string;
  /** full ranked cause list captured with the case */
  rankedCauses?: { causeId: CauseId; score: number }[];
  /** recommended troubleshooting step titles */
  actionPlan?: string[];
  /** optional 8D report fields saved with this case */
  reportData?: CaseReportData;
}

export interface PriorStats {
  causeId: CauseId;
  count: number;
  resolved: number;
  successRate: number;
}

const DB_NAME = 'nsw-dispense-ai';
const STORE = 'cases';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // v2: older records used the pre-Fix5 dispensing defectIds; clear them on
    // upgrade so the case browser shows only current-domain data
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('defectId', 'defectId');
        store.createIndex('timestamp', 'timestamp');
      } else if (req.transaction) {
        req.transaction.objectStore(STORE).clear();
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCase(record: Omit<CaseRecord, 'id'>): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add(record);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Insert or update a case. When `record.id` is set, the existing record is
 * updated in place (same case number, original timestamp preserved); otherwise
 * a new record is added. Returns the id.
 */
export async function upsertCase(record: CaseRecord): Promise<number> {
  const db = await openDB();
  if (record.id == null) {
    // a present-but-undefined keyPath value ('id: undefined') makes add() throw
    // "Data provided to an operation does not meet requirements", so strip it
    const data: CaseRecord = { ...record };
    delete data.id;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).add(data);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  }
  const id = record.id;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(id);
    get.onsuccess = () => {
      const existing = get.result as CaseRecord | undefined;
      // keep the original opened time when updating an existing case
      const merged: CaseRecord = { ...record, id, timestamp: existing?.timestamp ?? record.timestamp };
      const put = store.put(merged);
      put.onsuccess = () => resolve(put.result as number);
      put.onerror = () => reject(put.error);
    };
    get.onerror = () => reject(get.error);
  });
}

export async function resolveCase(id: number, resolvedCause: CauseId): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(id);
    get.onsuccess = () => {
      const rec = get.result as CaseRecord | undefined;
      if (!rec) return resolve();
      rec.resolvedCause = resolvedCause;
      store.put(rec);
      tx.oncomplete = () => resolve();
    };
    get.onerror = () => reject(get.error);
  });
}

export async function getAllCases(): Promise<CaseRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as CaseRecord[]);
    req.onerror = () => reject(req.error);
  });
}

export async function clearCases(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Delete a single stored case by its IndexedDB id. */
export async function deleteCase(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Merge a partial edit into a stored case, keeping its id and opened time. */
export async function patchCase(id: number, patch: Partial<CaseRecord>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(id);
    get.onsuccess = () => {
      const existing = get.result as CaseRecord | undefined;
      if (!existing) return resolve();
      const merged: CaseRecord = { ...existing, ...patch, id, timestamp: existing.timestamp };
      store.put(merged);
      tx.oncomplete = () => resolve();
    };
    get.onerror = () => reject(get.error);
  });
}

/** Aggregate prior statistics per cause from stored cases. */
export function computePriorStats(cases: CaseRecord[]): PriorStats[] {
  const map = new Map<CauseId, { count: number; resolved: number }>();
  for (const c of cases) {
    if (c.resolvedCause) {
      const e = map.get(c.resolvedCause) ?? { count: 0, resolved: 0 };
      e.count += 1;
      e.resolved += 1;
      map.set(c.resolvedCause, e);
    } else if (c.topCause) {
      const e = map.get(c.topCause) ?? { count: 0, resolved: 0 };
      e.count += 1;
      map.set(c.topCause, e);
    }
  }
  return [...map.entries()]
    .map(([causeId, e]) => ({
      causeId,
      count: e.count,
      resolved: e.resolved,
      successRate: e.count ? e.resolved / e.count : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Seed a realistic demo history so the "learned" story works on first run. */
export function seedCases(): Array<Omit<CaseRecord, 'id'>> {
  const seeds: Array<Omit<CaseRecord, 'id'>> = [];
  const now = Date.now();
  const day = 86400000;
  let i = 0;

  // defectId values match what the rule engine actually produces for the two
  // vision classes: Less Paste symptoms -> 'missing-dot', Bridging -> 'oversized-dot'
  // (verified against identifyDefect with boardClassToSymptoms inputs).
  const LP: SymptomId[] = ['amount-too-small', 'inconsistent-size'];
  const BR: SymptomId[] = ['spread-beyond', 'shape-irregular'];

  const mk = (defectId: DefectId, symptoms: SymptomId[], cause: CauseId) => {
    seeds.push({
      timestamp: now - Math.round((i / 20) * 90) * day,
      material: 'solder-paste',
      defectId,
      symptoms,
      topCause: cause,
      resolvedCause: cause,
    });
    i += 1;
  };

  // 12 Less Paste confirmations
  for (let n = 0; n < 5; n++) mk('missing-dot', LP, 'air-bubble');
  for (let n = 0; n < 3; n++) mk('missing-dot', LP, 'material-viscosity');
  for (let n = 0; n < 2; n++) mk('missing-dot', LP, 'nozzle-blockage');
  for (let n = 0; n < 2; n++) mk('missing-dot', LP, 'pressure-unstable');

  // 8 Bridging confirmations
  for (let n = 0; n < 3; n++) mk('oversized-dot', BR, 'pressure-unstable');
  for (let n = 0; n < 3; n++) mk('oversized-dot', BR, 'material-viscosity');
  for (let n = 0; n < 2; n++) mk('oversized-dot', BR, 'valve-wear');

  return seeds;
}

/** Convert stored cases into cause priors (0-1), blending with built-in priors. */
export function priorOverrides(cases: CaseRecord[]): Partial<Record<CauseId, number>> {
  const out: Partial<Record<CauseId, number>> = {};
  for (const s of computePriorStats(cases)) {
    if (s.count >= 3) {
      const empirical = s.resolved / Math.max(1, s.count);
      out[s.causeId] = 0.2 + 0.5 * empirical;
    }
  }
  return out;
}