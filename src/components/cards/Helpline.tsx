import type { Font } from '@/client/measure';
import { legible, mukta } from '@/fonts';
import { TYPE_INFO } from '@/shared/types';
import { ORG_LOGO, OrgHead } from './Modern';
import type { CardProps } from './PassCard';
import { Qr } from './Qr';
import { T, widthOf } from './v2kit';
import { stretchY, VH, VW } from './vehicleBox';

/**
 * The Free Helpline Sewa passes, E-Rickshaw, Eco and Metro: design round 24 (../passes-design-v2/cards/
 * r23-e-rickshaw-sewa), the owner's pick on 2026-11-15. Sewa Vehicle's heading and band (Modern.tsx) with
 * the sheet's word on the band, FREE HELPLINE SEWA under it, and no fields: the serial large at the left,
 * the signature under it, and at the right, in a box, "केवल बुजुर्गों व विकलांगों के लिए" (only for the
 * elderly and the disabled; the owner's words, kewal bujurgo v viklango ke liye) with the English under it.
 * Only the word and the colour differ between the three. 204 × 145 mm, drawn on 150 × VH (vehicleBox.ts;
 * laid out on 150 × 100, the y's through Y).
 */

const face = legible.style.fontFamily;
const REG: Font = { family: face, weight: 400 };
const BOLD: Font = { family: face, weight: 700 };
const HEAVY: Font = { family: face, weight: 800 };
/** Mukta 800 (Devanagari): the Hindi line. */
const HINDI: Font = { family: mukta.style.fontFamily, weight: 800 };
/** Loaded (and measured with) before any pass is drawn: see useCardFonts. Atkinson is in MODERN_FONTS. */
export const HELPLINE_FONTS = [HINDI];

const INK = '#231f20';
const WHITE = '#fff';
const mm = (n: number) => Math.round(n * 1000) / 1000;
/** "NOV - 2026" prints as "NOV – 2026". */
const tagText = (tag: string) => tag.trim().toUpperCase().replace(/\s*-\s*/g, ' – ');

/** The signature over its line, "Auth. signatory" under it, `x0` to `x1`; `y`: the line. */
function SignOff({ x0, x1, y, href }: { x0: number; x1: number; y: number; href: string }) {
  return (
    <g>
      {href && <image href={href} x={x0} y={mm(y - 7.6 - 0.3)} width={x1 - x0} height={7.6} preserveAspectRatio="xMidYMax meet" />}
      <rect x={x0} y={y} width={x1 - x0} height={0.18} fill={INK} />
      <T t="Auth. signatory" f={REG} cap={1.6} x={(x0 + x1) / 2} y={y + 3.2} align="middle" max={x1 - x0} />
    </g>
  );
}

export function HelplineVehicle({ p, texts, code }: CardProps) {
  const { title: kind, color } = TYPE_INFO[p.type];
  const ink = color.band;
  const [x0, x1] = [7, 143];
  const cx = VW / 2;
  const Y = stretchY(5, 96);
  const qr = 15;
  /* The band, as Sewa Vehicle's: the word white on the colour, edge to edge. */
  const [top, bottom] = [Y(33.6), Y(49)];
  const kcap = Math.min((bottom - top) / 1.9, 8.6);
  const pill = kcap * 1.9;
  const mid = (top + bottom) / 2;
  const sub = 'FREE HELPLINE SEWA';
  const scap = Math.min(5, (5 * (x1 - x0)) / widthOf(sub, HEAVY, 5));
  /** Two columns under FREE HELPLINE SEWA, their tops and feet lined up; the box is the right one, from `bx`. */
  const box = { top: Y(61), bottom: Y(95) };
  const bx = 58;
  const bmid = (bx + x1) / 2;
  return (
    <>
      <rect width={VW} height={VH} fill={WHITE} />
      <OrgHead x={x0} y={Y(6.5)} max={x1 - qr - 6 - (x0 + ORG_LOGO.w + 3.2)} />
      {code && <Qr text={code} x={x1 - qr} y={Y(7)} size={qr} pad={0} />}
      <T t="Vehicle pass" f={BOLD} cap={3.2} x={x0} y={Y(31.4)} />
      <T t={tagText(texts.tag)} f={BOLD} cap={3.2} x={x1} y={Y(31.4)} align="end" />
      <rect y={mm(mid - pill / 2)} width={VW} height={mm(pill)} fill={ink} />
      <T t={kind} f={HEAVY} cap={kcap} x={cx} y={mid + kcap / 2} align="middle" max={x1 - x0} fill={WHITE} />
      {/* Not twice: Eco's band already says it. */}
      {kind !== sub && <T t={sub} f={HEAVY} cap={scap} x={cx} y={Y(57.5)} align="middle" fill={ink} />}
      {/* Left: the serial, large, and the signature under it. */}
      <T t="Sr. no." f={REG} cap={2.4} x={x0} y={box.top + 2.4} />
      <T t={String(p.serial).padStart(3, '0')} f={HEAVY} cap={14} x={x0} y={box.top + 20.5} max={bx - 6 - x0} />
      <SignOff x0={x0} x1={x0 + 36} y={box.bottom - 4} href={texts.signature} />
      {/* Right: who may ride, in a box edged in the colour; the Hindi on two lines with room for its marks, English under it. */}
      <rect x={bx} y={mm(box.top)} width={x1 - bx} height={mm(box.bottom - box.top)} rx={2.4} fill={WHITE} stroke={ink} strokeWidth={0.7} />
      <T t="केवल बुजुर्गों व" f={HINDI} cap={5.6} x={bmid} y={box.top + 12.6} align="middle" max={x1 - bx - 8} fill={ink} />
      <T t="विकलांगों के लिए" f={HINDI} cap={5.6} x={bmid} y={box.top + 23.8} align="middle" max={x1 - bx - 8} fill={ink} />
      <T t="Only for the elderly and the disabled" f={BOLD} cap={2.4} x={bmid} y={box.top + 31} align="middle" max={x1 - bx - 8} fill={INK} />
    </>
  );
}
