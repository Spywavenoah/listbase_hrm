import { downloadHtmlAsPdf } from '@/lib/letterhead';

export interface PayslipDocumentEmployee {
  id: string;
  employee_id: string | null;
  first_name: string;
  last_name: string;
  email?: string | null;
  pension_pin?: string | null;
  pension_administrator?: string | null;
  nsitf_number?: string | null;
  tax_id?: string | null;
  department?: string | null;
  position?: string | null;
}

export interface PayslipDocumentPayslip {
  id: string;
  payslip_number: string | null;
  period_start: string | null;
  period_end: string | null;
  gross_pay: number | null;
  total_deductions: number | null;
  net_pay: number | null;
  employer_cost: number | null;
  status?: string | null;
}

export interface PayslipDocumentLedger {
  entry_type: 'ADDITION' | 'DEDUCTION' | 'EMPLOYER' | string;
  category?: string | null;
  name: string;
  amount: number | null;
  formula?: string | null;
  notes?: string | null;
}

export interface PayslipCompany {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export interface PayslipDocumentData {
  payslip: PayslipDocumentPayslip;
  employee: PayslipDocumentEmployee | null | undefined;
  ledger: PayslipDocumentLedger[];
  company?: PayslipCompany;
}

export function payslipMoney(value: number | null | undefined): string {
  return `\u20A6${(Number(value) || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function payslipEmployeeName(employee?: PayslipDocumentEmployee | null): string {
  if (!employee) return 'Employee';
  return `${employee.first_name} ${employee.last_name}`.trim() || 'Employee';
}

export function payslipPeriod(payslip: PayslipDocumentPayslip): string {
  const fmt = (value: string | null) =>
    value ? new Date(value + (value.length === 10 ? 'T00:00:00' : '')).toLocaleDateString() : '';
  if (payslip.period_start && payslip.period_end) {
    return `${fmt(payslip.period_start)} – ${fmt(payslip.period_end)}`;
  }
  if (payslip.period_start) return fmt(payslip.period_start);
  return '';
}

export function payslipFileName(data: PayslipDocumentData): string {
  const who = payslipEmployeeName(data.employee).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  const number = (data.payslip.payslip_number || data.payslip.id).replace(/[^a-z0-9-]+/gi, '-');
  return `payslip-${who}-${number}.pdf`.toLowerCase();
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

interface SectionRow {
  name: string;
  amount: number;
  detail?: string;
}

function sectionRows(
  ledger: PayslipDocumentLedger[],
  entryType: 'ADDITION' | 'DEDUCTION' | 'EMPLOYER',
  employee?: PayslipDocumentEmployee | null
): SectionRow[] {
  return ledger
    .filter((entry) => entry.entry_type === entryType)
    .map((entry) => {
      const bits = [entry.category, entry.formula, entry.notes].filter(
        (bit): bit is string => !!bit && bit.trim().length > 0
      );
      if (entry.category === 'PENSION' && employee?.pension_pin) bits.push(`PIN ${employee.pension_pin}`);
      if (entry.category === 'TAX' && employee?.tax_id) bits.push(`Tax ID ${employee.tax_id}`);
      if (entry.category === 'NSITF' && employee?.nsitf_number) bits.push(`NSITF ${employee.nsitf_number}`);
      return {
        name: entry.name,
        amount: Number(entry.amount || 0),
        detail: bits.join(' · '),
      };
    });
}

function tableHtml(title: string, rows: SectionRow[], total: number, tone: string): string {
  if (rows.length === 0) {
    return `<section class="block">
      <h2 class="${tone}">${esc(title)}</h2>
      <p class="muted">No ${esc(title.toLowerCase())} recorded.</p>
    </section>`;
  }
  return `<section class="block">
    <h2 class="${tone}">${esc(title)} <span class="muted">(${esc(payslipMoney(total))})</span></h2>
    <table>
      <thead><tr><th>Item</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
              <td>${esc(row.name)}${row.detail ? `<div class="detail">${esc(row.detail)}</div>` : ''}</td>
              <td class="num">${esc(payslipMoney(row.amount))}</td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>
  </section>`;
}

export interface StatutoryTotals {
  pensionEmployee: number;
  pensionEmployer: number;
  pensionTotal: number;
  paye: number;
  nsitf: number;
  additions: number;
  deductions: number;
  employer: number;
}

export function summariseStatutory(ledger: PayslipDocumentLedger[]): StatutoryTotals {
  const totals: StatutoryTotals = {
    pensionEmployee: 0,
    pensionEmployer: 0,
    pensionTotal: 0,
    paye: 0,
    nsitf: 0,
    additions: 0,
    deductions: 0,
    employer: 0,
  };
  for (const entry of ledger) {
    const amount = Number(entry.amount || 0);
    if (entry.entry_type === 'ADDITION') totals.additions += amount;
    if (entry.entry_type === 'DEDUCTION') totals.deductions += amount;
    if (entry.entry_type === 'EMPLOYER') totals.employer += amount;
    if (entry.category === 'PENSION') {
      if (entry.entry_type === 'EMPLOYER') totals.pensionEmployer += amount;
      else totals.pensionEmployee += amount;
    }
    if (entry.category === 'TAX' && entry.entry_type !== 'EMPLOYER') totals.paye += amount;
    if (entry.category === 'NSITF') totals.nsitf += amount;
  }
  totals.pensionTotal = totals.pensionEmployee + totals.pensionEmployer;
  return totals;
}

/** Payslip body used inside the PDF document and the payslip email. */
export function buildPayslipBodyHtml(data: PayslipDocumentData): string {
  const { payslip, employee, ledger, company } = data;
  const additions = sectionRows(ledger, 'ADDITION', employee);
  const deductions = sectionRows(ledger, 'DEDUCTION', employee);
  const employer = sectionRows(ledger, 'EMPLOYER', employee);
  const totals = summariseStatutory(ledger);

  const details: Array<[string, string]> = [
    ['Employee', payslipEmployeeName(employee)],
    ['Staff ID', employee?.employee_id || '—'],
    ['Department', employee?.department || '—'],
    ['Position', employee?.position || '—'],
    ['Pension PIN', employee?.pension_pin || '—'],
    ['Pension administrator', employee?.pension_administrator || '—'],
    ['Tax ID', employee?.tax_id || '—'],
    ['NSITF number', employee?.nsitf_number || '—'],
  ];

  return `
    <div class="payslip">
      <div class="head">
        <div>
          <div class="company">${esc(company?.name || '')}</div>
          <div class="muted">${[company?.address, company?.phone, company?.email].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
        <div class="head-right">
          <div class="doc-title">Payslip</div>
          <div class="muted">${esc(payslip.payslip_number || '')}</div>
          <div class="muted">${esc(payslipPeriod(payslip))}</div>
          ${payslip.status ? `<div class="badge">${esc(payslip.status)}</div>` : ''}
        </div>
      </div>

      <table class="details">
        ${details
          .map(
            ([label, value]) =>
              `<tr><th>${esc(label)}</th><td>${esc(value)}</td><th class="spacer"></th><td></td></tr>`
          )
          .join('')}
      </table>

      <div class="summary">
        <div><span class="muted">Gross pay</span><strong>${esc(payslipMoney(payslip.gross_pay))}</strong></div>
        <div><span class="muted">Deductions</span><strong>${esc(payslipMoney(payslip.total_deductions))}</strong></div>
        <div class="net"><span>Net pay</span><strong>${esc(payslipMoney(payslip.net_pay))}</strong></div>
        <div><span class="muted">Employer cost</span><strong>${esc(payslipMoney(payslip.employer_cost))}</strong></div>
      </div>

      ${tableHtml('Earnings', additions, totals.additions, 'tone-success')}
      ${tableHtml('Employee deductions', deductions, totals.deductions, 'tone-danger')}
      ${tableHtml('Employer contributions', employer, totals.employer, 'tone-info')}

      <section class="block">
        <h2 class="tone-info">Statutory remittances</h2>
        <table>
          <thead><tr><th>Deduction</th><th>Reference</th><th class="num">Amount</th></tr></thead>
          <tbody>
            <tr>
              <td>Pension (employee + employer)</td>
              <td class="detail">${esc([employee?.pension_administrator, employee?.pension_pin].filter(Boolean).join(' · ') || '—')}</td>
              <td class="num">${esc(payslipMoney(totals.pensionTotal))}</td>
            </tr>
            <tr>
              <td>PAYE tax</td>
              <td class="detail">${esc(employee?.tax_id || '—')}</td>
              <td class="num">${esc(payslipMoney(totals.paye))}</td>
            </tr>
            <tr>
              <td>NSITF</td>
              <td class="detail">${esc(employee?.nsitf_number || '—')}</td>
              <td class="num">${esc(payslipMoney(totals.nsitf))}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <p class="footer">This payslip is computer generated and does not require a signature.</p>
    </div>`;
}

/** Complete printable document (head + styles) used for PDF rendering. */
export function buildPayslipDocumentHtml(data: PayslipDocumentData): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${esc(payslipFileName(data))}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; background: #ffffff; margin: 0; padding: 24mm; font-size: 12px; }
      .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; }
      .company { font-size: 18px; font-weight: 700; letter-spacing: 0.02em; }
      .head-right { text-align: right; }
      .doc-title { font-size: 20px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
      .muted { color: #64748b; font-size: 11px; }
      .badge { display: inline-block; margin-top: 6px; padding: 2px 8px; border: 1px solid #cbd5e1; border-radius: 999px; font-size: 10px; text-transform: uppercase; }
      table { border-collapse: collapse; width: 100%; }
      table.details { margin-top: 16px; }
      table.details th { width: 22%; text-align: left; font-weight: 600; color: #475569; padding: 4px 8px 4px 0; font-size: 11px; }
      table.details td { width: 28%; padding: 4px 8px 4px 0; font-size: 11px; }
      table.details th.spacer { width: 22%; }
      .summary { display: flex; gap: 10px; margin: 18px 0; }
      .summary > div { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; }
      .summary span { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
      .summary strong { font-size: 13px; }
      .summary .net { background: #0f172a; color: #ffffff; border-color: #0f172a; }
      .summary .net span { color: #cbd5e1; }
      .block { margin-top: 18px; }
      .block h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 6px; }
      .tone-success { color: #047857; }
      .tone-danger { color: #b91c1c; }
      .tone-info { color: #1d4ed8; }
      th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
      thead th { background: #f8fafc; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; }
      .num { text-align: right; white-space: nowrap; }
      .detail { color: #64748b; font-size: 10px; margin-top: 2px; }
      .footer { margin-top: 22px; color: #94a3b8; font-size: 10px; text-align: center; }
      .payslip { page-break-inside: avoid; }
    </style>
  </head>
  <body>${buildPayslipBodyHtml(data)}</body>
</html>`;
}

/** HTML body for the payslip email (no letterhead wrapper). */
export function buildPayslipEmailHtml(data: PayslipDocumentData): string {
  return buildPayslipDocumentHtml(data);
}

export async function downloadPayslipPdf(data: PayslipDocumentData): Promise<void> {
  await downloadHtmlAsPdf({
    html: buildPayslipDocumentHtml(data),
    filename: payslipFileName(data),
  });
}
