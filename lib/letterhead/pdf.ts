import html2canvas from 'html2canvas-pro';
import jsPDF from 'jspdf';

export interface PdfOptions {
  html: string;
  filename: string;
}

export async function downloadHtmlAsPdf(opts: PdfOptions): Promise<void> {
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '794px';
  container.style.padding = '24mm';
  container.style.background = '#ffffff';
  container.innerHTML = opts.html;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgWidth = 210;
    const pageHeight = 297;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(opts.filename);
  } finally {
    document.body.removeChild(container);
  }
}

export function printHtml(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  }, 250);
}

export async function generatePdfWithLetterhead(params: {
  letterheadHtml?: string | null;
  title: string;
  subtitle?: string;
  meta?: Array<{ label: string; value: string }>;
  bodyHtml: string;
  filename: string;
}): Promise<void> {
  const { fetchDefaultLetterhead, getBrandVariables, buildLetterheadHtml, buildDocumentHtml } = await import('./render-deps');
  const vars = await getBrandVariables();
  let lh = params.letterheadHtml;
  if (!lh) {
    const def = await fetchDefaultLetterhead();
    lh = def ? buildLetterheadHtml(def.body_html, vars) : '';
  }
  const html = buildDocumentHtml({
    letterheadHtml: lh,
    title: params.title,
    subtitle: params.subtitle,
    meta: params.meta,
    bodyHtml: params.bodyHtml
  });
  await downloadHtmlAsPdf({ html, filename: params.filename });
}

export async function printWithLetterhead(params: {
  letterheadHtml?: string | null;
  title: string;
  subtitle?: string;
  meta?: Array<{ label: string; value: string }>;
  bodyHtml: string;
}): Promise<void> {
  const { fetchDefaultLetterhead, getBrandVariables, buildLetterheadHtml, buildDocumentHtml } = await import('./render-deps');
  const vars = await getBrandVariables();
  let lh = params.letterheadHtml;
  if (!lh) {
    const def = await fetchDefaultLetterhead();
    lh = def ? buildLetterheadHtml(def.body_html, vars) : '';
  }
  const html = buildDocumentHtml({
    letterheadHtml: lh,
    title: params.title,
    subtitle: params.subtitle,
    meta: params.meta,
    bodyHtml: params.bodyHtml
  });
  printHtml(html);
}
