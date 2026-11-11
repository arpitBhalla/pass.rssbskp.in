'use client';
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** What a pass's QR code holds: a link `${prefix}${digits}`, e.g. http://192.168.1.20:5180/v#1234…. */
export interface PassCode {
  prefix: string;
  digits: string;
}

/**
 * The QR's dark modules as one SVG path, 1 unit per module. The link is two parts: the address as bytes
 * and the code as digits (QR numeric mode, the densest: 3.3 bits a digit). A usual address gives 33 × 33
 * modules; printed 12–14 mm wide, each is about 0.36 mm, which phone cameras read easily.
 * Error correction M: still reads with about 15% of it scuffed.
 */
export function qrModules({ prefix, digits }: PassCode): { d: string; n: number } {
  const q = qrcode(0, 'M');
  q.addData(prefix, 'Byte');
  q.addData(digits, 'Numeric');
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

/** A QR code `size` mm square at (x, y) on a white square; `pad` mm of white inside it (the quiet zone). */
export function Qr({ code, x, y, size, pad }: { code: PassCode; x: number; y: number; size: number; pad: number }) {
  const { d, n } = useMemo(() => qrModules(code), [code]);
  const m = (size - 2 * pad) / n;
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} fill="#fff" />
      <path d={d} transform={`translate(${x + pad} ${y + pad}) scale(${m})`} fill="#231f20" shapeRendering="crispEdges" />
    </g>
  );
}
