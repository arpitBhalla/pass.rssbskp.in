'use client';
import { useEffect, useRef, useState } from 'react';
import { btn } from './ui';

/** How often a video frame is looked at, and how long a code in view counts as the same scan. */
const EVERY_MS = 120;
const SAME_MS = 2000;

/** A short beep: a code was read. */
function beep() {
  try {
    const a = new AudioContext();
    const o = a.createOscillator();
    const g = a.createGain();
    o.frequency.value = 1400;
    g.gain.value = 0.08;
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + 0.08);
    o.onended = () => void a.close();
  } catch { /* no sound: the list shows it */ }
}

/**
 * Live QR scanning with the camera (the owner, 2026-11-24: "can be scanned actively"): the camera stays on and each QR
 * code held up to it is read (jsQR on the video frames) and passed to `onCode`, with a beep; the same code is read once
 * while it stays in view. The back camera on a phone.
 */
export function LiveScan({ onCode }: { onCode: (text: string) => void }) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const latest = useRef(onCode);
  useEffect(() => { latest.current = onCode; });

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const last = { code: '', at: 0 };
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });
    (async () => {
      try {
        const [{ default: jsQR }, media] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false }),
        ]);
        stream = media;
        if (stopped || !video.current || !g) return;
        video.current.srcObject = media;
        await video.current.play();
        const look = () => {
          if (stopped) return;
          const v = video.current;
          if (v && v.videoWidth) {
            const k = Math.min(1, 800 / v.videoWidth);
            [canvas.width, canvas.height] = [Math.round(v.videoWidth * k), Math.round(v.videoHeight * k)];
            g.drawImage(v, 0, 0, canvas.width, canvas.height);
            const found = jsQR(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
            const now = Date.now();
            if (found?.data) {
              if (found.data !== last.code || now - last.at > SAME_MS) {
                beep();
                navigator.vibrate?.(60);
                latest.current(found.data);
              }
              Object.assign(last, { code: found.data, at: now });
            }
          }
          timer = window.setTimeout(look, EVERY_MS);
        };
        look();
      } catch (e) {
        if (stopped) return;
        const name = (e as Error).name;
        setError(name === 'NotAllowedError' ? 'The camera is blocked: allow it for this site in the browser, then try again.'
          : name === 'NotFoundError' ? 'No camera found.' : `The camera could not start (${(e as Error).message}).`);
        setOn(false);
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on]);

  return (
    <div className="contents">
      <button className={btn} onClick={() => { setError(''); setOn((x) => !x); }}>{on ? 'Stop camera' : 'Scan with camera'}</button>
      {error && <span className="text-[14px] font-semibold text-red-700">{error}</span>}
      {on && (
        <div className="basis-full">
          <video ref={video} muted playsInline className="aspect-[4/3] w-full max-w-md rounded-[3px] border-2 border-primary bg-black object-cover" />
          <p className="mt-1 text-[13.5px] text-muted-foreground">Hold each pass&apos;s QR code up to the camera: it beeps when read.</p>
        </div>
      )}
    </div>
  );
}
