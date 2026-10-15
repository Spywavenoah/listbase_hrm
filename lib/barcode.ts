export const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

/**
 * Encode a string to Code 128B module widths. Returns an array of alternating
 * bar/space module widths, index 0 being a bar. Throws if a character is not
 * representable in Code 128B (ASCII 32-127).
 */
export function code128Encode(value: string): number[] {
  if (!value) throw new Error('Barcode value is empty');
  const widths: number[] = [];

  const pushPattern = (idx: number) => {
    const pattern = CODE128_PATTERNS[idx];
    if (!pattern) throw new Error(`Invalid Code128 symbol: ${idx}`);
    for (const ch of pattern) widths.push(Number(ch));
  };

  const values: number[] = [];
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 127) {
      throw new Error(`Character "${ch}" cannot be encoded in Code 128B`);
    }
    values.push(code - 32);
  }

  pushPattern(START_B);
  let checksum = START_B;
  values.forEach((v, i) => {
    pushPattern(v);
    checksum += v * (i + 1);
  });
  pushPattern(checksum % 103);
  pushPattern(STOP);

  return widths;
}

export interface BarcodeSvgOptions {
  height?: number;
  moduleWidth?: number;
  showText?: boolean;
  fontSize?: number;
  label?: string;
}

/** Render a Code 128B barcode as a self-contained SVG string. */
export function code128Svg(value: string, opts: BarcodeSvgOptions = {}): string {
  const { height = 64, moduleWidth = 2, showText = true, fontSize = 12, label } = opts;
  const widths = code128Encode(value);
  const quiet = 10;
  const totalModules = widths.reduce((sum, w) => sum + w, 0);
  const width = (totalModules + quiet * 2) * moduleWidth;
  const textHeight = showText ? fontSize + 6 : 0;
  const svgHeight = height + textHeight;

  let x = quiet * moduleWidth;
  const bars: string[] = [];
  widths.forEach((w, i) => {
    const barWidth = w * moduleWidth;
    if (i % 2 === 0) {
      bars.push(`<rect x="${x}" y="0" width="${barWidth}" height="${height}" fill="#000" />`);
    }
    x += barWidth;
  });

  const caption = label ? `${value}${label ? ` · ${label}` : ''}` : value;
  const text = showText
    ? `<text x="${width / 2}" y="${height + fontSize}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${fontSize}" fill="#000">${escapeXml(caption)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}" role="img" aria-label="Barcode ${escapeXml(value)}">${bars.join('')}${text}</svg>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Open a print dialog with a printable barcode label. */
export function printBarcode(value: string, label?: string): void {
  const svg = code128Svg(value, { height: 90, moduleWidth: 3, showText: true, label });
  const title = label ? `${label} (${value})` : value;
  const w = window.open('', '_blank', 'width=520,height=360');
  if (!w) return;
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(title)}</title></head>` +
      `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif">` +
      svg +
      `</body></html>`
  );
  w.document.close();
  w.focus();
  w.print();
}
