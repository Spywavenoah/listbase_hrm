export type CsvValue = string | number | boolean | null | undefined;

export interface CsvSection {
  title: string;
  headers: string[];
  rows: CsvValue[][];
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsvLine(cells: CsvValue[]): string {
  return cells.map(escapeCell).join(',');
}

export function csvFileName(base: string): string {
  const safe =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'export';
  return `${safe}_${new Date().toISOString().split('T')[0]}.csv`;
}

function triggerDownload(filename: string, content: string) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, headers: string[], rows: CsvValue[][]): void {
  const lines: CsvValue[][] = [headers, ...rows];
  triggerDownload(filename, lines.map(toCsvLine).join('\r\n'));
}

export function downloadCsvSections(filename: string, sections: CsvSection[]): void {
  const blocks = sections
    .filter((section) => section.headers.length > 0)
    .map((section) => {
      const lines: CsvValue[][] = [[section.title], section.headers, ...section.rows];
      return lines.map(toCsvLine).join('\r\n');
    });
  triggerDownload(filename, blocks.join('\r\n\r\n'));
}
