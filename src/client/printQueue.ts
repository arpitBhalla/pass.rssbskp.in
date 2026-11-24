'use client';
import { type PassItem, passList } from './passList';

/**
 * The print queue: passes waiting to be printed, kept in this browser (localStorage) since 2026-11-23, so a
 * reload or a second tab keeps it (the owner; it was this tab's memory only). Nothing is lost if it is cleared:
 * the passes stay unprinted in the register. Passes of the same size print together on one paper sheet (Mobile
 * Pandal with Non Pandal, the car passes, …), so a sheet fills sooner; printed all together, passes of different
 * sizes share sheets too (pagesFor in lib/sheets.ts).
 */
export type QueueItem = PassItem;

export const printQueue = passList('passes.printQueue');
export const usePrintQueue = printQueue.use;
