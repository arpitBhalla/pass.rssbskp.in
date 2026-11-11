import JsBarcode from 'jsbarcode';

/** Code 128 bar pattern for a value: one character per module, "1" = black bar. */
export function barcodeBits(value: string): string {
  const data: { encodings?: { data: string }[] } = {};
  JsBarcode(data, value, { format: 'CODE128' });
  return (data.encodings ?? []).map((e) => e.data).join('');
}

/** SVG path drawing the bars on a grid `quiet` modules in from the left, 10 units tall. */
export function barcodePath(bits: string, quiet: number): string {
  let d = '';
  for (let i = 0; i < bits.length; ) {
    if (bits[i] !== '1') { i++; continue; }
    let j = i;
    while (bits[j] === '1') j++;
    d += `M${i + quiet} 0h${j - i}v10h-${j - i}z`;
    i = j;
  }
  return d;
}
