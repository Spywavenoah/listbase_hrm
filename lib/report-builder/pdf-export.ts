import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface CompanyInfo {
  name: string;
  address: string;
  logoUrl: string;
  taxId: string;
  registrationNumber: string;
}

export async function fetchCompanyInfo(): Promise<CompanyInfo> {
  const { supabase } = await import('@/lib/supabase/client');
  const { data } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('group_name', ['company', 'branding']);

  const info: CompanyInfo = {
    name: '',
    address: '',
    logoUrl: '',
    taxId: '',
    registrationNumber: '',
  };

  if (data) {
    for (const row of data) {
      if (row.key === 'company_name') info.name = String(row.value || '');
      if (row.key === 'company_address') info.address = String(row.value || '');
      if (row.key === 'company_logo_url') info.logoUrl = String(row.value || '');
      if (row.key === 'logo_url' && !info.logoUrl) info.logoUrl = String(row.value || '');
      if (row.key === 'tax_id') info.taxId = String(row.value || '');
      if (row.key === 'registration_number') info.registrationNumber = String(row.value || '');
    }
  }

  if (!info.name) {
    const { data: branding } = await supabase
      .from('system_settings')
      .select('value')
      .eq('group_name', 'branding')
      .eq('key', 'app_name')
      .maybeSingle();
    info.name = String(branding?.value || 'Company');
  }

  return info;
}

async function loadLogoImage(logoUrl: string): Promise<{ format: string; base64: string } | null> {
  if (!logoUrl) return null;
  try {
    const response = await fetch(logoUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return null;

    const isPng = blob.type === 'image/png';
    const isJpeg = blob.type === 'image/jpeg' || blob.type === 'image/jpg';
    if (!isPng && !isJpeg) return null;

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    return { format: isPng ? 'PNG' : 'JPEG', base64 };
  } catch {
    return null;
  }
}

export async function exportToPDF(
  columns: { label: string; path: string }[],
  rows: Record<string, unknown>[],
  reportTitle: string,
  companyInfo: CompanyInfo
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  let logoHeight = 0;
  let logoSize = 0;
  const logoData = await loadLogoImage(companyInfo.logoUrl);
  if (logoData) {
    logoSize = 16;
    doc.addImage(logoData.base64, logoData.format, margin, margin, logoSize, logoSize);
    logoHeight = logoSize;
  }

  const headerX = logoHeight > 0 ? margin + logoSize + 6 : margin;
  const headerY = logoHeight > 0 ? margin + 6 : margin + 4;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(companyInfo.name || reportTitle, headerX, headerY);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  if (companyInfo.address) {
    const splitAddress = doc.splitTextToSize(companyInfo.address, pageWidth - headerX - margin);
    doc.text(splitAddress, headerX, headerY + 5);
  }

  const infoY = headerY + (companyInfo.address ? 12 : 5);
  const infoParts: string[] = [];
  if (companyInfo.taxId) infoParts.push(`Tax ID: ${companyInfo.taxId}`);
  if (companyInfo.registrationNumber) infoParts.push(`Reg No: ${companyInfo.registrationNumber}`);
  if (infoParts.length > 0) {
    doc.setFontSize(8);
    doc.text(infoParts.join('  |  '), headerX, infoY);
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(reportTitle, pageWidth / 2, headerY, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  doc.text(`Generated: ${dateStr} at ${timeStr}`, pageWidth - margin, headerY, { align: 'right' });

  const tableHead = [columns.map((c) => c.label)];
  const tableBody = rows.map((row) =>
    columns.map((col) => {
      const val = row[col.path];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    })
  );

  const startY = Math.max(infoY + 6, margin + logoHeight + 6, margin + 20);

  autoTable(doc, {
    head: tableHead,
    body: tableBody,
    startY,
    margin: { left: margin, right: margin },
    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    didDrawPage: (data) => {
      const pageNum = doc.getNumberOfPages();
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `Page ${data.pageNumber} of ${pageNum}`,
        pageWidth - margin,
        pageHeight - 6,
        { align: 'right' }
      );
      doc.text(
        `${rows.length} records`,
        margin,
        pageHeight - 6
      );
    },
  });

  doc.save(`${reportTitle.replace(/\s+/g, '_').toLowerCase()}_${now.toISOString().split('T')[0]}.pdf`);
}
