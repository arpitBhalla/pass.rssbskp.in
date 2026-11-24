'use client';

/**
 * Finds a QR code in a photo from the phone's camera: the whole photo, then its middle enlarged, then
 * the whole at a higher resolution (a pass photographed from further away).
 */
export async function readPhoto(file: File): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const [W, H] = [img.naturalWidth, img.naturalHeight];
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    const tried = new Set<string>();
    for (const [part, most] of [[1, 1600], [0.5, 1600], [1, 2800]]) {
      const [sw, sh] = [W * part, H * part];
      const k = Math.min(1, most / Math.max(sw, sh));
      const [w, h] = [Math.round(sw * k), Math.round(sh * k)];
      if (tried.has(`${part} ${w}`)) continue;
      tried.add(`${part} ${w}`);
      await new Promise((r) => setTimeout(r)); // lets "Reading the photo…" show first
      [canvas.width, canvas.height] = [w, h];
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, w, h);
      const found = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (found) return found.data;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
