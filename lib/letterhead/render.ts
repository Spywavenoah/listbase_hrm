import { interpolate } from './fetch';

export function buildLetterheadHtml(letterheadBodyHtml: string, vars: Record<string, string>): string {
  return interpolate(letterheadBodyHtml, vars);
}

export interface DocumentOptions {
  letterheadHtml: string;
  title: string;
  subtitle?: string;
  meta?: Array<{ label: string; value: string }>;
  bodyHtml: string;
}

export function buildDocumentHtml(opts: DocumentOptions): string {
  const meta = (opts.meta || [])
    .map((m) => `<div><strong>${escapeHtml(m.label)}:</strong> ${escapeHtml(m.value)}</div>`)
    .join('');
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(opts.title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; background: #ffffff; margin: 0; padding: 24mm; }
      @media print { body { padding: 20mm; } }
      .meta { margin-top: 8px; color: #334155; font-size: 12px; line-height: 1.8; }
      .subtitle { margin-top: 6px; color: #475569; font-size: 13px; }
      .title { margin: 18px 0 10px; font-size: 22px; font-weight: 700; }
      .body { margin-top: 22px; font-size: 13px; line-height: 1.7; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
      th { background: #f8fafc; font-weight: 600; }
      .noborder th, .noborder td { border: none; padding: 6px 4px; }
    </style>
  </head>
  <body>
    ${opts.letterheadHtml}
    <div class="title">${escapeHtml(opts.title)}</div>
    ${opts.subtitle ? `<div class="subtitle">${escapeHtml(opts.subtitle)}</div>` : ''}
    ${meta ? `<div class="meta">${meta}</div>` : ''}
    <div class="body">${opts.bodyHtml}</div>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
