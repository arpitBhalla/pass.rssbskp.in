'use client';
import { useEffect, useRef } from 'react';

/** A scanner at full speed types each key this soon after the last: after 8 such digits, its keys are kept from the page at once. */
const FAST_MS = 70;
const RUN = 8;
/**
 * Faster than anyone types: 6 keys in a row, each within 35 ms, letters too. The owner's phone app types stray text when it is closed
 * (2026-11-25): such a burst is the scanner's, kept from the page, and if it isn't a pass code, thrown away. So is a character key
 * repeating by itself (a key the scanner left held down).
 */
const GUARD_MS = 35;
const GUARD_RUN = 6;
/** A slower scanner (a phone app over Bluetooth): keys this close are one scan, told apart at the end by ending in a whole pass code. */
const SLOW_MS = 500;
/**
 * Once a scanner is typing, a pause this long still isn't the end: Bluetooth sends keys in bursts (the owner's phone app, 2026-11-25,
 * stopped after 12 of the 44 digits for over half a second). Only a scan that breaks off waits it out: a whole code is done at once.
 */
const WAIT_MS = 1500;
/** After a whole code, the scanner's Enter (or Tab) that follows within this long is kept from the page. */
const TAIL_MS = 400;
/** What a pass QR code holds: 44 digits (in a scanner's prefix and suffix, or an old pass's link). Nobody types that by hand. */
const CODE = /(?:^|\D)[1-9]\d{43}\D*$/;
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);

type Field = HTMLInputElement | HTMLTextAreaElement;
const isField = (el: Element | null): el is Field => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

/** Sets a box's text as if typed (React sees it). */
function setValue(el: Field, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * A scanner typing a pass code (a Bluetooth handheld, or a phone app acting as a Bluetooth keyboard, with or without a prefix; the
 * owner, 2026-11-25), caught on any page wherever the cursor is: no box needs clicking first. A fast scanner is told apart by speed
 * (8 digits in a row, each within 70 ms) and its keys kept from the page from there; a slower one by ending in a whole code, 44 digits.
 * A scan is done the moment its 44th digit comes (its Enter, after, is kept from the page too). Either way, what it typed into the box with the cursor (its prefix too) is taken back (a sheet cell it
 * started editing goes back to what it held), and its Enter doesn't reach the page. A box marked `data-scanbox` handles scans itself.
 */
export function useScannerCatch(onCode: (code: string) => void, on = true) {
  const latest = useRef(onCode);
  useEffect(() => { latest.current = onCode; });

  useEffect(() => {
    if (!on) return;
    let text = '';
    let last = 0;
    let fast = 0;
    let fastAny = 0;
    let capturing = false;
    let timer = 0;
    /** Where the keys started: the box with the cursor, what it held, and whether it was being typed in. */
    let start: { el: Element | null; value: string; editing: boolean } | null = null;
    let ours = false; // the Escape sent to a sheet cell below
    let tailUntil = 0; // a scan just done: its Enter, still to come, isn't the page's

    const reset = () => { text = ''; fast = 0; fastAny = 0; capturing = false; start = null; window.clearTimeout(timer); };
    /** What went to the box with the cursor: taken back. */
    const takeBack = () => {
      const el = start?.el ?? null;
      if (!isField(el)) return;
      if (el.dataset.k !== undefined && !start!.editing) { // a sheet cell it started editing: dropped, as Escape does
        ours = true;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        ours = false;
      } else if (el.value !== start!.value) setValue(el, start!.value);
    };
    const isScan = () => capturing || CODE.test(text);
    /** A scan: taken back from the page, and what it typed handed on. */
    const done = () => {
      const scanned = text;
      if (!capturing) takeBack();
      reset();
      latest.current(scanned);
    };

    const onKey = (e: KeyboardEvent) => {
      if (ours || e.ctrlKey || e.metaKey || e.altKey || MODIFIERS.has(e.key)) return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.dataset.scanbox !== undefined) return reset();
      const now = e.timeStamp;
      if (now < tailUntil) {
        tailUntil = 0;
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); return; }
      }
      if (e.key.length === 1) { // a character: a scanner's prefix, its digits, or someone typing
        const gap = now - last;
        if (!text || (gap > SLOW_MS && !capturing)) {
          reset();
          start = { el, value: isField(el) ? el.value : '', editing: isField(el) && !el.readOnly };
        }
        const digit = /\d/.test(e.key);
        fast = digit && text && gap <= FAST_MS ? fast + 1 : 0;
        fastAny = text && gap <= GUARD_MS ? fastAny + 1 : 0;
        text += e.key;
        last = now;
        if (!capturing && (fast >= RUN - 1 || fastAny >= GUARD_RUN - 1 || e.repeat)) { capturing = true; takeBack(); }
        if (CODE.test(text)) { // a whole code: done now, its Enter kept from the page when it comes
          e.preventDefault();
          e.stopImmediatePropagation();
          done();
          tailUntil = now + TAIL_MS;
          return;
        }
        if (capturing) { e.preventDefault(); e.stopImmediatePropagation(); }
        window.clearTimeout(timer);
        timer = window.setTimeout(() => (capturing ? done() : reset()), capturing ? WAIT_MS : SLOW_MS);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && text && (capturing || (now - last <= SLOW_MS && isScan()))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        done();
        return;
      }
      if (capturing) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      reset(); // someone typing: not a scan
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.clearTimeout(timer); };
  }, [on]);
}
