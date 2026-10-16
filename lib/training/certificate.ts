import jsPDF from 'jspdf';

export interface CertificateRenderInput {
  certificateId: string;
  employeeName: string;
  courseTitle: string;
  instructor?: string | null;
  issuedAt: Date;
  expiresAt: Date | null;
  cycle: number;
  organization?: string;
}

function fmt(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Render the completion certificate as a PDF buffer (landscape A4). */
export function renderCertificatePdf(input: CertificateRenderInput): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  // border
  doc.setDrawColor(30, 64, 120);
  doc.setLineWidth(1.2);
  doc.rect(10, 10, w - 20, h - 20);
  doc.setLineWidth(0.4);
  doc.rect(14, 14, w - 28, h - 28);

  doc.setTextColor(30, 64, 120);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text('Certificate of Completion', w / 2, 48, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(70, 70, 70);
  doc.text('This is to certify that', w / 2, 70, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(20, 20, 20);
  doc.text(input.employeeName, w / 2, 88, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(70, 70, 70);
  doc.text('has successfully completed the training course', w / 2, 106, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(30, 64, 120);
  const title = doc.splitTextToSize(input.courseTitle, w - 60) as string[];
  doc.text(title, w / 2, 124, { align: 'center' });

  const infoY = 124 + title.length * 8 + 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(70, 70, 70);
  const info: string[] = [];
  if (input.instructor) info.push(`Instructor: ${input.instructor}`);
  if (input.cycle > 1) info.push(`Renewal cycle: ${input.cycle}`);
  info.push(`Issued: ${fmt(input.issuedAt)}`);
  info.push(
    input.expiresAt ? `Valid until: ${fmt(input.expiresAt)}` : 'No expiry'
  );
  doc.text(info.join('     |     '), w / 2, infoY, { align: 'center' });

  // signature / id line
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.4);
  doc.line(w / 2 - 60, h - 52, w / 2 + 60, h - 52);
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(input.organization || 'Human Resources', w / 2, h - 46, { align: 'center' });

  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Certificate ID: ${input.certificateId}`, w / 2, h - 30, { align: 'center' });

  const bytes = doc.output('arraybuffer');
  return Buffer.from(bytes);
}
