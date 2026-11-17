import type { Font } from '@/client/measure';
import { legible, mukta } from '@/fonts';
import { TYPE_INFO } from '@/shared/types';
import { KindWord, kindCap, ORG_LOGO, OrgHead } from './Modern';
import type { CardProps } from './PassCard';
import { Qr } from './Qr';
import { T, widthOf } from './v2kit';
import { drawHeight, stretchY, VW } from './vehicleBox';

/**
 * The Free Helpline Sewa passes, E-Rickshaw, Eco and Metro: design round 24 (../passes-design-v2/cards/
 * r23-e-rickshaw-sewa), the owner's pick on 2026-11-15. Sewa Vehicle's heading and band (Modern.tsx) with
 * the sheet's word on the band, FREE HELPLINE SEWA under it, and no fields: the serial large at the left,
 * the signature under it, and at the right, in a box, "केवल बुजुर्गों व विकलांगों के लिए" (only for the
 * elderly and the disabled; the owner's words, kewal bujurgo v viklango ke liye) with the English under it.
 * Only the word and the colour differ between the three. 232 × 158 mm (Tractor Trolley's size), drawn on 150 × drawHeight (vehicleBox.ts;
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
  const h = drawHeight(TYPE_INFO[p.type].layout);
  const Y = stretchY(5, 96, h);
  const qr = 15;
  /*
   * The band, as Sewa Vehicle's since 2026-11-16 (the owner): higher, closer to the heading, one height on
   * all three, and the word in Atkinson 800 as it is, a little extra letter space, as large as it fits (KindWord).
   */
  const [top, bottom] = [Y(29.4), Y(48.4)];
  const kcap = kindCap([kind], (bottom - top) / 1.9, x1 - x0);
  const pill = bottom - top;
  const mid = (top + bottom) / 2;
  const sub = 'FREE HELPLINE SEWA';
  const scap = Math.min(5, (5 * (x1 - x0)) / widthOf(sub, HEAVY, 5));
  /** Not twice: Eco's band already says it, and its columns move up into the room. */
  const hasSub = kind !== sub;
  /** Two columns under FREE HELPLINE SEWA, their tops and feet lined up; the box is the right one, from `bx`. */
  const box = { top: Y(hasSub ? 61 : 55), bottom: Y(95) };
  const bx = 58;
  const bmid = (bx + x1) / 2;
  /** The Hindi, larger (2026-11-16), its two lines 2.4 cap apart and centred in the box: their marks reach about 1.45 cap above a line and 0.45 below. */
  const hcap = 7;
  const hmid = (box.top + box.bottom) / 2;
  return (
    <>
      <rect width={VW} height={h} fill={WHITE} />
      <OrgHead x={x0} y={Y(6.5)} max={x1 - qr - 6 - (x0 + ORG_LOGO.w + 3.2)} />
      {code && <Qr text={code} x={x1 - qr} y={Y(7)} size={qr} pad={0} />}
      <T t="Vehicle pass" f={BOLD} cap={3.2} x={x0} y={Y(27.2)} />
      <T t={tagText(texts.tag)} f={BOLD} cap={3.2} x={x1} y={Y(27.2)} align="end" />
      <rect y={mm(mid - pill / 2)} width={VW} height={mm(pill)} fill={ink} />
      <KindWord t={kind} cap={kcap} x={cx} y={mid + kcap / 2} max={x1 - x0} fill={WHITE} />
      {hasSub && <T t={sub} f={HEAVY} cap={scap} x={cx} y={Y(57.5)} align="middle" fill={ink} />}
      {/* Left: the serial, large, and the signature under it. */}
      <T t="Sr. no." f={REG} cap={2.4} x={x0} y={box.top + 2.4} />
      <T t={String(p.serial).padStart(3, '0')} f={HEAVY} cap={14} x={x0} y={box.top + 20.5} max={bx - 6 - x0} />
      <SignOff x0={x0} x1={x0 + 36} y={box.bottom - 4} href={texts.signature} />
      {/* Right: who may ride, in a box edged in the colour; the Hindi on two lines (no English under it since 2026-11-16). */}
      <rect x={bx} y={mm(box.top)} width={x1 - bx} height={mm(box.bottom - box.top)} rx={2.4} fill={WHITE} stroke={ink} strokeWidth={0.7} />
      <T t="केवल बुजुर्गों व" f={HINDI} cap={hcap} x={bmid} y={hmid - 0.7 * hcap} align="middle" max={x1 - bx - 8} fill={ink} />
      <T t="विकलांगों के लिए" f={HINDI} cap={hcap} x={bmid} y={hmid + 1.7 * hcap} align="middle" max={x1 - bx - 8} fill={ink} />
    </>
  );
}
