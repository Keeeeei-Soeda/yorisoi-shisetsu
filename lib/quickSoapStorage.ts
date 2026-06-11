import type { QuickSoapFilter, QuickSoapRecord } from '../types.ts';

const STORAGE_KEY = 'yorisoi:shisetsu:quick-soaps';

function loadAll(): QuickSoapRecord[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as QuickSoapRecord[];
  } catch {
    return [];
  }
}

function saveAll(records: QuickSoapRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    throw new Error(
      'localStorage の容量上限に達しました。不要な履歴を削除してください。',
      { cause: error },
    );
  }
}

export function createQuickSoapRecord(
  input: Omit<QuickSoapRecord, 'id' | 'createdAt' | 'updatedAt'>,
): QuickSoapRecord {
  const now = new Date().toISOString();
  return {
    ...input,
    id: `qs-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  };
}

export function saveQuickSoap(record: QuickSoapRecord): void {
  const records = loadAll();
  const index = records.findIndex((r) => r.id === record.id);
  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }
  saveAll(records);
}

export function getQuickSoap(id: string): QuickSoapRecord | null {
  return loadAll().find((r) => r.id === id) ?? null;
}

export function listQuickSoaps(filter?: QuickSoapFilter): QuickSoapRecord[] {
  let records = loadAll();

  if (filter?.facilityId !== undefined) {
    records = records.filter((r) => r.facilityId === filter.facilityId);
  }
  if (filter?.rosterPatientId !== undefined) {
    records = records.filter((r) => r.rosterPatientId === filter.rosterPatientId);
  }
  if (filter?.dateFrom !== undefined) {
    records = records.filter((r) => r.date >= filter.dateFrom!);
  }
  if (filter?.dateTo !== undefined) {
    records = records.filter((r) => r.date <= filter.dateTo!);
  }

  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteQuickSoap(id: string): void {
  saveAll(loadAll().filter((r) => r.id !== id));
}

export function updateQuickSoap(
  id: string,
  partial: Partial<QuickSoapRecord>,
): QuickSoapRecord | null {
  const records = loadAll();
  const index = records.findIndex((r) => r.id === id);
  if (index < 0) return null;

  const existing = records[index];
  const updated: QuickSoapRecord = {
    ...existing,
    ...partial,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  records[index] = updated;
  saveAll(records);
  return updated;
}
