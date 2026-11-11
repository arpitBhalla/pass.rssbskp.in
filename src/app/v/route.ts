import { gatePage } from '@/server/gatePage';
import { PASS_TYPES, TYPE_INFO } from '@/shared/types';

export const dynamic = 'force-dynamic';

/** The page a pass's QR code opens: /v#<code>. Public; checking against the register needs a login. */
export function GET() {
  const html = gatePage({
    types: PASS_TYPES.map((t) => ({ id: t, label: TYPE_INFO[t].label, band: TYPE_INFO[t].color.band })),
  });
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}
