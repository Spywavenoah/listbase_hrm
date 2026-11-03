import { downloadHtmlAsPdf } from '@/lib/letterhead';

export interface RegisterDocumentRow {
  periodStart: string | null;
  periodEnd: string | null;
  runName: string;
  payslipNumber: string;
  typeLabel: string;
  staffId: string;
  employeeName: string;
  pensionPin: string;
  pensionAdministrator: string;
  taxId: string;
  nsitfNumber: string;
  employeeAmount: number;
  employerAmount: number;
  total: number;
}

export interface RegisterDocumentCompany {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export interface RegisterDocumentTotals {
  employee: number;
  employer: number;
  total: number;
}

export interface RegisterDocumentOptions {
  title: string;
  subtitle?: string;
  rows: RegisterDocumentRow[];
  totals: RegisterDocumentTotals;
  company?: RegisterDocumentCompany;
  generatedAt?: Date;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function registerMoney(value: number | null | undefined): string {
  return `\u20A6${(Number(value) || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(value: string | null): string {
  if (!value) return '';
  return new Date(value + (value.length === 10 ? 'T00:00:00' : '')).toLocaleDateString();
}

function statutoryReference(row: RegisterDocumentRow): string {
  if (row.typeLabel === 'Pension') return row.pensionPin;
  if (row.typeLabel === 'PAYE Tax') return row.taxId;
  if (row.typeLabel === 'NSITF') return row.nsitfNumber;
  return '';
}

function authority(row: RegisterDocumentRow): string {
  if (row.typeLabel === 'Pension') return row.pensionAdministrator;
  if (row.typeLabel === 'PAYE Tax') return 'Tax authority';
  if (row.typeLabel === 'NSITF') return 'NSITF';
  return '';
}

export function buildRegisterDocumentHtml(opts: RegisterDocumentOptions): string {
  const { title, subtitle, rows, totals, company } = opts;
  const generatedAt = (opts.generatedAt || new Date()).toLocaleString();

  const header = `
    <div class="head">
      <div>
        <div class="company">${esc(company?.name || '')}</div>
        <div class="muted">${[company?.address, company?.phone, company?.email].filter(Boolean).map(esc).join(' · ')}</div>
      </div>
      <div class="head-right">
        <div class="doc-title">${esc(title)}</div>
        ${subtitle ? `<div class="muted">${esc(subtitle)}</div>` : ''}
        <div class="muted">Generated ${esc(generatedAt)}</div>
      </div>
    </div>`;

  const summary = `
    <div class="summary">
      <div><span class="muted">Entries</span><strong>${esc(String(rows.length))}</strong></div>
      <div><span class="muted">Employee share</span><strong>${esc(registerMoney(totals.employee))}</strong></div>
      <div><span class="muted">Employer share</span><strong>${esc(registerMoney(totals.employer))}</strong></div>
      <div class="net"><span>Total remittance</span><strong>${esc(registerMoney(totals.total))}</strong></div>
    </div>`;

  const body =
    rows.length === 0
      ? '<p class="muted">No entries matched the selected filters.</p>'
      : `<table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Employee</th>
              <th>Type</th>
              <th>Authority</th>
              <th>Statutory ID</th>
              <th class="num">Employee</th>
              <th class="num">Employer</th>
              <th class="num">Total</th>
              <th>Payslip</th>
              <th>Run</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `<tr>
                  <td class="nowrap">${esc(fmtDate(row.periodStart))}${row.periodEnd ? ` – ${esc(fmtDate(row.periodEnd))}` : ''}</td>
                  <td>${esc(row.employeeName)}<div class="detail">${esc(row.staffId || 'No staff ID')}</div></td>
                  <td>${esc(row.typeLabel)}</td>
                  <td>${esc(authority(row))}</td>
                  <td class="mono">${esc(statutoryReference(row) || '—')}</td>
                  <td class="num">${esc(registerMoney(row.employeeAmount))}</td>
                  <td class="num">${esc(registerMoney(row.employerAmount))}</td>
                  <td class="num strong">${esc(registerMoney(row.total))}</td>
                  <td class="mono">${esc(row.payslipNumber || '—')}</td>
                  <td>${esc(row.runName || '—')}</td>
                </tr>`
              )
              .join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="5"><strong>Totals</strong></td>
              <td class="num">${esc(registerMoney(totals.employee))}</td>
              <td class="num">${esc(registerMoney(totals.employer))}</td>
              <td class="num">${esc(registerMoney(totals.total))}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>`;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${esc(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; background: #ffffff; margin: 0; padding: 16mm; font-size: 10px; }
      .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 10px; }
      .company { font-size: 16px; font-weight: 700; }
      .head-right { text-align: right; }
      .doc-title { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
      .muted { color: #64748b; font-size: 9px; }
      .summary { display: flex; gap: 8px; margin: 14px 0; }
      .summary > div { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; }
      .summary span { display: block; font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; }
      .summary strong { font-size: 11px; }
      .summary .net { background: #0f172a; color: #ffffff; border-color: #0f172a; }
      .summary .net span { color: #cbd5e1; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #e2e8f0; padding: 4px 5px; text-align: left; vertical-align: top; }
      thead th { background: #f8fafc; font-size: 8px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
      tfoot td { background: #f8fafc; font-weight: 600; }
      .num { text-align: right; white-space: nowrap; }
      .nowrap { white-space: nowrap; }
      .mono { font-family: 'Courier New', monospace; font-size: 9px; }
      .strong { font-weight: 600; }
      .detail { color: #64748b; font-size: 8px; margin-top: 1px; }
    </style>
  </head>
  <body>
    ${header}
    ${summary}
    ${body}
  </body>
</html>`;
}

export async function downloadRegisterPdf(
  filename: string,
  opts: RegisterDocumentOptions
): Promise<void> {
  await downloadHtmlAsPdf({ html: buildRegisterDocumentHtml(opts), filename });
}
