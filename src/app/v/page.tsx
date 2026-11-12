import type { Metadata, Viewport } from 'next';
import { GateCheck } from '@/components/GateCheck';

export const metadata: Metadata = { title: 'Pass check', robots: { index: false }, referrer: 'no-referrer' };
export const viewport: Viewport = { themeColor: '#890e01' };

/** The gate check page: volunteers scan passes with their phones. Checking needs a login. */
export default function GatePage() {
  return <GateCheck />;
}
