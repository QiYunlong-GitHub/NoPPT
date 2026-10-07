export type ResponseRecord = Record<string, unknown>;

export function asResponseRecord(value: unknown): ResponseRecord {
  return isResponseRecord(value) ? value : {};
}

export function isResponseRecord(value: unknown): value is ResponseRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function responseString(record: ResponseRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function responseNumber(record: ResponseRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function responseRecord(record: ResponseRecord, key: string): ResponseRecord | undefined {
  const value = record[key];
  return isResponseRecord(value) ? value : undefined;
}

export function responseRecords(record: ResponseRecord, key: string): ResponseRecord[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isResponseRecord) : [];
}

export function responseUnknownArray(record: ResponseRecord, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}
