import { downloadHtmlAsPdf, getBrandVariables } from '@/lib/letterhead';
import type { MaterialIssueReceipt } from '@/lib/inventory';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function qty(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function employeeName(
  row?: { first_name: string | null; last_name: string | null } | null
): string {
  if (!row) return '—';
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || '—';
}

function receiptFileName(receipt: MaterialIssueReceipt): string {
  const number = (receipt.receipt_number || receipt.id).replace(/[^a-z0-9-]+/gi, '-');
  return `material-issue-receipt-${number}.pdf`.toLowerCase();
}

export function buildIssueReceiptBodyHtml(
  receipt: MaterialIssueReceipt,
  vars: Record<string, string>
): string {
  const lines = receipt.lines || [];
  const totalIssued = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const companyName = vars.company_name || vars.app_name || 'Inventory';
  const companyLine = [vars.company_address, vars.company_phone, vars.company_email]
    .filter(Boolean)
    .map(esc)
    .join(' · ');

  return `
    <div class="doc">
      <div class="head">
        <div>
          ${vars.company_logo_url ? `<img src="${esc(vars.company_logo_url)}" alt="" class="logo" />` : ''}
          <div class="company">${esc(companyName)}</div>
          ${companyLine ? `<div class="muted">${companyLine}</div>` : ''}
        </div>
        <div class="head-right">
          <div class="doc-title">Material Issue Receipt</div>
          <div class="muted">${esc(receipt.receipt_number)}</div>
          <div class="muted">${esc(dateTime(receipt.issued_at))}</div>
        </div>
      </div>

      <table class="details">
        <tr>
          <th>Material request</th><td>${esc(receipt.request?.request_number || '—')}</td>
          <th>Warehouse</th><td>${esc(receipt.request?.warehouse?.name || '—')}</td>
        </tr>
        <tr>
          <th>Recipient</th><td>${esc(receipt.recipient_name)}</td>
          <th>Issued by</th><td>${esc(employeeName(receipt.issued_by_employee))}</td>
        </tr>
        <tr>
          <th>Issue date</th><td>${esc(dateTime(receipt.issued_at))}</td>
          <th>Lines</th><td>${lines.length}</td>
        </tr>
        <tr>
          <th>Acknowledgement</th>
          <td colspan="3">
            ${
              receipt.acknowledged_at
                ? `${esc(receipt.acknowledgement_method === 'SIGNED_COPY' ? 'Signed copy' : 'Recipient confirmation')} · ${esc(dateTime(receipt.acknowledged_at))} · ${esc(employeeName(receipt.acknowledged_by_employee))}`
                : 'Pending recipient acknowledgement'
            }
          </td>
        </tr>
      </table>

      <table class="items">
        <thead>
          <tr>
            <th class="num">SN</th>
            <th>Material</th>
            <th>Unit</th>
            <th class="num">Requested</th>
            <th class="num">Approved</th>
            <th class="num">Issued now</th>
            <th class="num">Cumulative issued</th>
          </tr>
        </thead>
        <tbody>
          ${lines
            .map((line, index) => {
              const source = line.request_item;
              return `<tr>
                <td class="num">${index + 1}</td>
                <td>${esc(source?.item_name || '—')}</td>
                <td>${esc(source?.uom || '')}</td>
                <td class="num">${esc(qty(source?.quantity_requested))}</td>
                <td class="num">${esc(qty(source?.quantity_approved ?? source?.quantity_requested))}</td>
                <td class="num">${esc(qty(line.quantity))}</td>
                <td class="num">${esc(qty(source?.quantity_issued))}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
        <tfoot>
          <tr>
            <th colspan="5" class="num">Total issued on this receipt</th>
            <th class="num">${esc(qty(totalIssued))}</th>
            <th></th>
          </tr>
        </tfoot>
      </table>

      ${receipt.comment ? `<p class="note"><strong>Comment:</strong> ${esc(receipt.comment)}</p>` : ''}
      ${receipt.signed_document_url ? `<p class="note"><strong>Signed copy:</strong> ${esc(receipt.signed_document_url)}</p>` : ''}

      <div class="signatures">
        <div><span>Issued by signature</span><div class="line"></div></div>
        <div><span>Receiver signature</span><div class="line"></div></div>
        <div><span>Date</span><div class="line"></div></div>
      </div>

      <p class="footer">
        ${esc(companyName)} · ${esc(receipt.receipt_number)} · Generated ${esc(dateTime(new Date().toISOString()))}
      </p>
    </div>`;
}

export function buildIssueReceiptDocumentHtml(
  receipt: MaterialIssueReceipt,
  vars: Record<string, string>
): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${esc(receipt.receipt_number)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; background: #ffffff; margin: 0; padding: 18mm; font-size: 11px; }
      .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 10px; }
      .logo { max-height: 48px; max-width: 190px; margin-bottom: 6px; object-fit: contain; }
      .company { font-size: 17px; font-weight: 700; letter-spacing: 0.02em; }
      .head-right { text-align: right; }
      .doc-title { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
      .muted { color: #64748b; font-size: 10px; }
      table { border-collapse: collapse; width: 100%; }
      table.details { margin-top: 14px; }
      table.details th { width: 16%; text-align: left; font-weight: 600; color: #475569; padding: 4px 8px 4px 0; font-size: 10px; }
      table.details td { width: 34%; padding: 4px 8px 4px 0; font-size: 10px; }
      table.items { margin-top: 16px; }
      th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
      thead th { background: #0f172a; color: #ffffff; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; }
      tfoot th { background: #f8fafc; }
      .num { text-align: right; white-space: nowrap; }
      .note { margin-top: 12px; font-size: 10px; color: #334155; overflow-wrap: anywhere; }
      .signatures { display: flex; gap: 28px; margin-top: 34px; }
      .signatures > div { flex: 1; }
      .signatures span { font-size: 10px; color: #475569; }
      .signatures .line { margin-top: 22px; border-top: 1px solid #94a3b8; }
      .footer { margin-top: 22px; color: #94a3b8; font-size: 9px; text-align: center; }
    </style>
  </head>
  <body>${buildIssueReceiptBodyHtml(receipt, vars)}</body>
</html>`;
}

export async function downloadIssueReceiptPdf(receipt: MaterialIssueReceipt): Promise<void> {
  const vars = await getBrandVariables();
  await downloadHtmlAsPdf({
    html: buildIssueReceiptDocumentHtml(receipt, vars),
    filename: receiptFileName(receipt),
  });
}
