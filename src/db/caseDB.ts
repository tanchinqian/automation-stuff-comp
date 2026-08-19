import type { CauseId, DefectId, SymptomId } from '../engine/types';

export interface CaseRecord {
  id?: number;
  timestamp: number;
  material: string;
  defectId: DefectId;
  symptoms: SymptomId[];
  topCause: CauseId;
  resolvedCause?: CauseId;
  notes?: string;
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
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('defectId', 'defectId');
        store.createIndex('timestamp', 'timestamp');
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
  const mk = (
    daysAgo: number,
    material: string,
    defectId: DefectId,
    symptoms: SymptomId[],
    resolvedCause: CauseId,
  ) => seeds.push({ timestamp: now - daysAgo * day, material, defectId, symptoms, topCause: resolvedCause, resolvedCause });

  // Inconsistent volume -> air bubble (8 cases as in the spec's example)
  mk(2, 'adhesive', 'inconsistent-volume', ['inconsistent-size', 'occurrence-occasional', 'material-voids'], 'air-bubble');
  mk(5, 'adhesive', 'inconsistent-volume', ['inconsistent-size', 'occurrence-occasional'], 'air-bubble');
  mk(9, 'adhesive', 'inconsistent-volume', ['inconsistent-size', 'time-based-drift'], 'air-bubble');
  mk(12, 'solder-paste', 'inconsistent-volume', ['inconsistent-size', 'occurrence-occasional', 'starts-after-pause'], 'air-bubble');
  mk(14, 'solder-paste', 'inconsistent-volume', ['inconsistent-size', 'occurrence-occasional'], 'air-bubble');
  mk(16, 'epoxy', 'inconsistent-volume', ['inconsistent-size', 'material-voids'], 'air-bubble');
  mk(19, 'epoxy', 'inconsistent-volume', ['inconsistent-size', 'occurrence-occasional', 'material-voids'], 'air-bubble');
  mk(22, 'adhesive', 'inconsistent-volume', ['inconsistent-size', 'occurrence-occasional'], 'air-bubble');

  // Undersized -> nozzle blockage / viscosity / cure
  mk(3, 'epoxy', 'undersized-dot', ['amount-too-small', 'occurrence-continuous'], 'nozzle-blockage');
  mk(8, 'adhesive', 'undersized-dot', ['amount-too-small', 'needle-tip-buildup'], 'material-cure');
  mk(15, 'thermal-paste', 'undersized-dot', ['amount-too-small', 'volume-decreases-over-time'], 'material-viscosity');
  mk(21, 'sealant', 'undersized-dot', ['amount-too-small', 'temperature-varied'], 'material-viscosity');
  mk(28, 'conformal-coating', 'undersized-dot', ['amount-too-small', 'occurrence-continuous'], 'nozzle-blockage');

  // Oversized -> viscosity / dispense time
  mk(4, 'adhesive', 'oversized-dot', ['amount-too-large', 'occurrence-continuous'], 'dispense-time');
  mk(11, 'solder-paste', 'oversized-dot', ['amount-too-large', 'temperature-varied'], 'material-viscosity');
  mk(18, 'thermal-paste', 'oversized-dot', ['amount-too-large', 'occurrence-continuous'], 'dispense-time');

  // Missing -> air / blockage / empty
  mk(6, 'adhesive', 'missing-dot', ['missing-occasionally', 'missing-location', 'occurrence-occasional'], 'air-bubble');
  mk(13, 'solder-paste', 'missing-dot', ['missing-occasionally', 'occurrence-occasional'], 'contamination-particle');
  mk(20, 'epoxy', 'missing-dot', ['missing-occasionally', 'missing-location'], 'nozzle-blockage');
  mk(25, 'sealant', 'missing-dot', ['missing-occasionally', 'volume-decreases-over-time'], 'syringe-empty');

  // Excessive spread -> viscosity / height
  mk(7, 'adhesive', 'excessive-spread', ['spread-beyond', 'surface-wetting', 'occurrence-continuous'], 'material-viscosity');
  mk(17, 'conformal-coating', 'excessive-spread', ['spread-beyond', 'surface-wetting'], 'needle-height');
  mk(26, 'thermal-paste', 'excessive-spread', ['spread-beyond', 'temperature-varied'], 'material-viscosity');

  // Irregular shape -> air / height / speed
  mk(10, 'solder-paste', 'irregular-shape', ['shape-irregular', 'dot-elongated'], 'needle-height');
  mk(23, 'adhesive', 'irregular-shape', ['shape-irregular', 'material-voids', 'occurrence-occasional'], 'air-bubble');
  mk(27, 'epoxy', 'irregular-shape', ['shape-irregular', 'dot-elongated', 'speed-slow-fast'], 'speed-motion');
  mk(29, 'sealant', 'irregular-shape', ['shape-irregular', 'occurrence-occasional', 'material-voids'], 'air-bubble');

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