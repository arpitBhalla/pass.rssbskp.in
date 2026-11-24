'use client';
import { passList } from './passList';

/**
 * The passes picked for the next packet, kept in this browser until tagged on the Packets page: scanned there, or
 * picked in a sheet with "Add to packet" (the owner, 2026-11-24). A reload or a break loses nothing.
 */
export const packetScan = passList('passes.packetScan');
