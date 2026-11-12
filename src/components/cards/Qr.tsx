'use client';
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * The QR's dark modules as one SVG path, 1 unit per module. Digits use QR numeric mode (the densest:
 * 3.3 bits a digit), anything else bytes. A pass's code alone (44 digits) at error correction Q is
 * 25 × 25 modules: printed 12–14 mm wide, each is about 0.5 mm, and it still reads with about a quarter
 * of it scuffed.
 */
export function qrModules(text: string, ec: 'M' | 'Q' = 'Q'): { d: string; n: number } {
  const q = qrcode(0, ec);
  q.addData(text, /^\d+$/.test(text) ? 'Numeric' : 'Byte');
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!q.isDark(r, c)) continue;
      const start = c;
      while (c + 1 < n && q.isDark(r, c + 1)) c++;
      d += `M${start} ${r}h${c + 1 - start}v1h${start - c - 1}z`;
    }
  }
  return { d, n };
}

/** A QR code of `text`, `size` units square at (x, y) on a white square; `pad` units of white inside it (the quiet zone). */
export function Qr({ text, x, y, size, pad, ec }: { text: string; x: number; y: number; size: number; pad: number; ec?: 'M' | 'Q' }) {
  const { d, n } = useMemo(() => qrModules(text, ec), [text, ec]);
  const m = (size - 2 * pad) / n;
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} fill="#fff" />
      <path d={d} transform={`translate(${x + pad} ${y + pad}) scale(${m})`} fill="#231f20" shapeRendering="crispEdges" />
    </g>
  );
}
