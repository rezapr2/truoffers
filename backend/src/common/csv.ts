import type { Response } from 'express';

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Neutralise spreadsheet formulas and quote anything with separators.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: { key: string; label: string; value?: (row: T) => unknown }[]): string {
  const header = columns.map((c) => cell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => cell(c.value ? c.value(row) : row[c.key])).join(','));
  return [header, ...lines].join('\r\n');
}

/** Sends CSV from a controller using `@Res({ passthrough: true })`. */
export function csvResponse(res: Response, filename: string, csv: string): string {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  // A byte-order mark so Excel reads the file as UTF-8 (£, accents).
  return `\uFEFF${csv}`;
}
