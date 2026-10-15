'use client';

import { code128Svg, printBarcode } from '@/lib/barcode';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';

interface BarcodeProps {
  value: string;
  label?: string;
  height?: number;
  moduleWidth?: number;
  showText?: boolean;
  className?: string;
}

export function Barcode({ value, label, height = 64, moduleWidth = 2, showText = true, className }: BarcodeProps) {
  let svg: string;
  try {
    svg = code128Svg(value, { height, moduleWidth, showText, label });
  } catch {
    return <span className="text-xs text-destructive">Invalid barcode value</span>;
  }
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function PrintBarcodeButton({
  value,
  label,
  className,
  variant = 'outline',
  size = 'sm',
}: {
  value: string;
  label?: string;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}) {
  return (
    <Button type="button" variant={variant} size={size} className={className} onClick={() => printBarcode(value, label)}>
      <Printer className="mr-1.5 h-4 w-4" />
      Print barcode
    </Button>
  );
}
