'use client';
import { memo, type SVGProps, useEffect, useState } from 'react';
import { type Font, inkWidth, layLine, loadFonts, type Placed, placeText, scaleFor } from '@/client/measure';
import { condensed, heavy, humanist } from '@/fonts';
import type { CardData } from '@/lib/passes';
import { CARD_SIZE } from '@/lib/sheets';
import { type Layout, type PassType, TYPE_INFO } from '@/shared/types';
import { Motorbike, Tractor } from './art';
import { Qr } from './Qr';
import { LABEL_FONT, LEDGER_FONTS, LedgerVehicle } from './Ledger';
import { RailVehicle } from './Rail';
import { TicketVehicle } from './Ticket';
import { HELPLINE_FONTS, HelplineVehicle } from './Helpline';
import { MODERN_FONTS, ModernVehicle } from './Modern';
import { RssbLogo } from './rssbLogo';
import { shiftOf, stretchY, VH, VW } from './vehicleBox';
import { T as Text, V2_FONTS, widthOf } from './v2kit';

/**
 * The three RSSB SKP pass templates (Downloads/passes-template), redrawn as vectors in mm. Every
 * position, size and colour below was measured on the templates. Static text is fitted to the
 * template's exact ink box; filled-in values use the template's lettering width and shrink to fit.
 *
 * v1 (2026-11-11), the user's changes to the templates: the tab with the tag ("NOV - 2026") on every
 * pass, "RSSB SIKANDERPUR-M.C." as the heading of the 150 × 100 mm passes, and no "Valid For" line on
 * Bike passes. To make room for the tab, Mobile's rows, QR, Sr. No. and signature sit 1–4 mm higher
 * than on the template, and Bike's signature 0.6 mm higher.
 *
 * v2 (2026-11-14): Gate 3 - VIP and Admin print in the new designs the user picked from
 * ../passes-design-v2: the Ticket (Ticket.tsx) and the Rail (Rail.tsx). The other sheets are as in v1.
 *
 * v3 (2026-11-14): two more picks. Gate 1 & 12 Entry (the BAV Parking sheet) prints as the Rail with a
 * parking sign and "GATE 1 & 12 ENTRY" / "BAV PARKING" as two lines of one size; Gate 3 Entry prints as
 * the Ledger with a colour bar (Ledger.tsx), without Area and Dept.
 *
 * v4 (2026-11-14): new sizes. Mobile passes are 50 × 60 mm (was 63.5 × 88.9), laid out again at 0.675
 * the size; Bike passes are 100 × 68 mm (was 88 × 60), the same drawing 1.14 times as big.
 *
 * v5 (2026-11-14): Mobile passes are 36 × 45 mm, the 50 × 60 drawing 0.75 as big.
 *
 * v6 (2026-11-15): Mobile passes get the heading the user picked from ../passes-design-v2 ("R14 · App
 * heading · tidy stack"): RSSB; "SIKANDERPUR – M.C. | ZONE-III" on one line; MOBILE PASS white in a
 * small pill of the pass colour; PANDAL / NON PANDAL. All in Roboto Condensed (bundled), black, where
 * v1's heading was Tahoma with two grey lines. Their tab with the tag is in the pass colour too, with
 * white letters. The logo and everything else are as in v5.
 *
 * v7 (2026-11-15): "SIKANDERPUR (MC)" in every heading (was "SIKANDERPUR-M.C." / "SIKANDERPUR – M.C.").
 * Bike passes are 145 × 99 mm (was 100 × 68), the largest size that puts 4 on an A4 sheet; their tab
 * is the pass colour with white letters, as on Mobile passes. BikeCardPlate: a variant with the Reg. No.
 * large in a number plate, shown in ../passes-design-v2 for the user to choose (not printed).
 * Later the same day: every logo is the official artwork, traced (rssbLogo.tsx), in the colours it had; Mobile
 * and Bike passes lose the grey line over their bottom band; BikeCardLedger, another variant to choose from,
 * and BikeCardWhite (it on a white body, the header still coloured); BikeCardTidy, the Bike pass laid out again,
 * BikeCardTidyLabel / BikeCardTidyBand, two calmer headings for it (…Month: the month up in the band), and
 * BikeCardTidyCentre, its heading centred.
 * The owner picked BikeCardLedger (design round 16): the Bike pass now prints with the Reg. No. in a
 * number plate and every label small above its value. The month tab on Mobile and Bike passes is the
 * bottom band's own colour (Non Pandal's tab was a deeper grey than its band).
 */

/** The design version, kept here only (not printed). Raise it when the design changes. */
export const TEMPLATE_VERSION = 'v7';

/** Shared by every desk: set once in Settings. */
export interface PrintTexts {
  signature: string;
  /** The tab at the bottom of every pass, e.g. "NOV - 2026". */
  tag: string;
}

const INK = '#231f20';
const DARK = '#414042';
const RED = '#9e0b0f';
const RULE = '#6d6e71';
/** Non Pandal's grey a shade deeper, where white letters sit on it (the Mobile heading's pill and tab). */
const TONE_GREY = '#5f6062';

const NARROW: Font = { family: condensed.style.fontFamily, weight: 700 };
const NARROW_HEAVY: Font = { family: condensed.style.fontFamily, weight: 800 };
const NARROW_BLACK: Font = { family: condensed.style.fontFamily, weight: 900 };
const HUMANIST: Font = { family: humanist.style.fontFamily, weight: 600 };
const SANS: Font = { family: 'Tahoma, Verdana, "DejaVu Sans", sans-serif', weight: 700 };
const BLACK: Font = { family: heavy.style.fontFamily, weight: 400 };
const FONTS = [NARROW, NARROW_HEAVY, NARROW_BLACK, HUMANIST, SANS, BLACK, ...V2_FONTS, ...LEDGER_FONTS, ...MODERN_FONTS, ...HELPLINE_FONTS];

/** True once the card fonts are loaded: cards are measured with them, so draw only after. */
export function useCardFonts(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => { if (live) setReady(true); };
    loadFonts(FONTS).then(done, done);
    return () => { live = false; };
  }, []);
  return ready;
}

/* ---------- text ---------- */

type TextAttrs = Omit<SVGProps<SVGTextElement>, 'x' | 'y' | 'fontSize' | 'children' | 'ref'>;

/** SVG text drawn exactly as laid out. Spaces are non-breaking so SVG never drops them. */
function Line({ p, y, f, t, ...attrs }: { p: Placed; y: number; f: Font; t: string } & TextAttrs) {
  return (
    <text x={p.x} y={y} fontSize={p.size} textLength={p.length} lengthAdjust="spacingAndGlyphs"
      style={{ fontFamily: f.family, fontWeight: f.weight }} fill={INK} {...attrs}>
      {t.replace(/ /g, ' ')}
    </text>
  );
}

/** Template text: its ink spans x0 → x1, `cap` tall, on baseline `y`. */
function Fixed({ t, f, cap, x0, x1, y, ...attrs }: { t: string; f: Font; cap: number; x0: number; x1: number; y: number } & TextAttrs) {
  return <Line p={placeText(t, f, cap, x0, x1)} y={y} f={f} t={t} {...attrs} />;
}

/** A filled-in value: `cap` tall, lettering width `scale`, shrunk to fit `max`. */
function Value({ t, f, cap, x, y, scale, max, align, ...attrs }: {
  t: string; f: Font; cap: number; x: number; y: number; scale?: number; max?: number; align?: 'start' | 'middle' | 'end';
} & TextAttrs) {
  if (!t) return null;
  return <Line p={layLine(t, f, cap, { x, align, scale, max })} y={y} f={f} t={t} {...attrs} />;
}

const serialText = (serial: number, digits: number) => String(serial).padStart(digits, '0');
const upper = (v: string) => v.trim().toUpperCase();

/* ---------- RSSB logo box ---------- */

type Box = [x0: number, y0: number, x1: number, y1: number];
interface LogoSpec {
  /** White frame behind the logo (where it sits on a coloured band). */
  frame?: Box;
  /** The logo's outer edges (its ring). */
  line: Box;
}

/** The RSSB logo (traced from the official artwork, rssbLogo.tsx) in the pass's colours. */
function Logo({ s, color, letters = '#fff', line = color }: { s: LogoSpec; color: string; letters?: string; line?: string }) {
  const [x0, y0, x1, y1] = s.line;
  return (
    <g>
      {s.frame && <rect x={s.frame[0]} y={s.frame[1]} width={s.frame[2] - s.frame[0]} height={s.frame[3] - s.frame[1]} fill="#fff" />}
      <RssbLogo x0={x0} y0={y0} x1={x1} y1={y1} color={color} letters={letters} line={line} />
    </g>
  );
}

const BIKE_LOGO: LogoSpec = { frame: [1.83, 1.5, 13.3, 15.73], line: [2.28, 1.95, 12.85, 15.28] };
const VEHICLE_LOGO: LogoSpec = { line: [6.64, 30.29, 29.89, 58.6] };
/** The faint logo inside the details box of vehicle passes: its letters only, light grey. */
const WATERMARK: LogoSpec = { line: [91.01, 43.25, 113.6, 70.9] };

function Signature({ href, x, y, w, h }: { href: string; x: number; y: number; w: number; h: number }) {
  return href ? <image href={href} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMax meet" /> : null;
}

/** "— ZONE-III —" */
function Zone({ dashes, text, cap, y, thick }: { dashes: [number, number, number, number]; text: [number, number]; cap: number; y: number; thick: number }) {
  const mid = y - cap / 2 - thick / 2;
  return (
    <g fill={DARK}>
      <rect x={dashes[0]} y={mid} width={dashes[1] - dashes[0]} height={thick} />
      <rect x={dashes[2]} y={mid} width={dashes[3] - dashes[2]} height={thick} />
      <Fixed t="ZONE-III" f={NARROW} cap={cap} x0={text[0]} x1={text[1]} y={y} fill={DARK} />
    </g>
  );
}

const mm = (n: number) => Math.round(n * 100) / 100;

/** The tag's lettering on the 150 × 100 mm template: "SKP-2026", caps 5.03 mm, ink 34.42 mm wide. */
const TAG_CAP = 5.03;
const TAG_WIDTH = 34.42;

/**
 * The tab with the tag (Settings), drawn like the 150 × 100 mm template's and scaled to `cap`: it rises
 * from the stripe whose top is `base` and is as wide as the tag. `into`: how far it goes into the stripe
 * (same colour, so no seam). Text over `max` mm shrinks. `letters`: white with a dark outline (on the
 * light tabs), or plain white (on a tab of the pass colour).
 */
function TagTab({ t, cx, base, cap, max, into, fill, letters = 'outlined' }: {
  t: string; cx: number; base: number; cap: number; max: number; into: number; fill: string; letters?: 'outlined' | 'white';
}) {
  const tag = t.trim();
  if (!tag) return null;
  const k = cap / TAG_CAP;
  const scale = scaleFor('SKP-2026', BLACK, TAG_CAP, TAG_WIDTH);
  const half = Math.min(inkWidth(tag, BLACK, cap, scale), max) / 2 + 5.18 * k;
  const [x0, x1, top, bot, r, f] = [cx - half, cx + half, base - 8.92 * k, base + into, 3 * k, 1.86 * k].map(mm);
  const d = `M${mm(x0 - f)} ${bot}Q${x0} ${bot} ${x0} ${mm(bot - f)}V${mm(top + r)}Q${x0} ${top} ${mm(x0 + r)} ${top}`
    + `H${mm(x1 - r)}Q${x1} ${top} ${x1} ${mm(top + r)}V${mm(bot - f)}Q${x1} ${bot} ${mm(x1 + f)} ${bot}Z`;
  return (
    <g>
      <path d={d} fill={fill} />
      {letters === 'outlined'
        ? <Value t={tag} f={BLACK} cap={cap} x={cx} y={base - 1.12 * k} align="middle" scale={scale} max={max}
            fill="#fff" stroke={DARK} strokeWidth={0.32 * k} paintOrder="stroke" strokeLinejoin="round" />
        : <Value t={tag} f={BLACK} cap={cap} x={cx} y={base - 1.12 * k} align="middle" scale={scale} max={max} fill="#fff" />}
    </g>
  );
}

export interface CardProps {
  p: CardData;
  texts: PrintTexts;
  /** The pass's code from the server (44 digits), printed as its QR code; none: no QR. */
  code?: string;
}

/* ---------- Mobile pass: 36 × 45 mm ---------- */

/*
 * Laid out on the 50 × 60 mm drawing (the numbers below; that was the template made 0.675 as big) and
 * printed 0.75 as big (45 / 60, 2026-11-14). The 1.5 mm of width that leaves over comes out of the
 * middle: the left column, the centred heading and the right column (QR, signature) each keep their
 * place from their own edge. The QR code is 7.5 mm.
 */
const MW = CARD_SIZE.mobile.w;
const MS = CARD_SIZE.mobile.h / 60;
const ML = (x: number) => x * MS; // from the left edge
const MC = (x: number) => MW / 2 + (x - 25) * MS; // from the middle
const MR = (x: number) => MW - (50 - x) * MS; // from the right edge
const MY = (y: number) => y * MS;

const MOBILE_LOGO: LogoSpec = (() => {
  const box = ([x0, y0, x1, y1]: Box): Box => [MC(x0), MY(y0), MC(x1), MY(y1)];
  return { frame: box([20.83, 0.73, 29.17, 10.62]), line: box([21.15, 1.05, 28.85, 10.3]) };
})();

/** `max`: room for the value (on the 50 × 60 drawing); Dept., Area and Phone stop 2 mm short of the QR code (its quiet zone). */
const MOBILE_ROWS = [
  { label: 'NAME', key: 'name', y: 34.16, end: 47 },
  { label: 'DEPT', key: 'dept', y: 38.34, end: 35.4 },
  { label: 'AREA', key: 'area', y: 42.53, end: 35.4 },
  { label: 'PHONE', key: 'phone', y: 46.71, end: 35.4 },
] as const;

/**
 * The heading under the logo (v6, "tidy stack"), centred, on the 50 × 60 drawing: RSSB; the city and
 * zone on one line; MOBILE PASS white in a pill of `tone`; the kind word, PANDAL and NON PANDAL at one
 * size, the largest thing on the pass.
 */
function MobileHeading({ pandal, tone }: { pandal: boolean; tone: string }) {
  const cap = (n: number) => n * MS;
  const cx = MW / 2;
  const label = cap(1.53);
  const track = label * 0.22;
  const pill = { w: widthOf('MOBILE PASS', NARROW_HEAVY, label, track) + cap(3.2) * 1.2, h: cap(3.2), y: MY(20.93) };
  const kind = Math.min(cap(4.53), ...['PANDAL', 'NON PANDAL'].map((t) => cap(4.53) * (cap(44) / widthOf(t, NARROW_BLACK, cap(4.53)))));
  return (
    <g>
      <Text t="RSSB" f={NARROW_BLACK} cap={cap(4.4)} x={cx} y={MY(16)} align="middle" fill={INK} />
      <Text t="SIKANDERPUR (MC)   |   ZONE-III" f={NARROW} cap={cap(1.6)} x={cx} y={MY(19.33)} align="middle" max={cap(44)} fill={INK} />
      <rect x={mm(cx - pill.w / 2)} y={mm(pill.y)} width={mm(pill.w)} height={mm(pill.h)} rx={mm(pill.h / 2)} fill={tone} />
      <Text t="MOBILE PASS" f={NARROW_HEAVY} cap={label} x={cx} y={pill.y + pill.h / 2 + label / 2} align="middle" track={track} fill="#fff" />
      <Text t={pandal ? 'PANDAL' : 'NON PANDAL'} f={NARROW_BLACK} cap={kind} x={cx} y={MY(29.33)} align="middle" fill={INK} />
    </g>
  );
}

function MobileCard({ p, texts, code }: CardProps) {
  const c = TYPE_INFO[p.type].color;
  const pandal = p.type === 'mobile-pandal';
  /** The heading's pill: the pass colour (Non Pandal's grey a shade deeper, for the white letters). */
  const tone = pandal ? c.band : TONE_GREY;
  const k = scaleFor('NAME', NARROW, 2.11, 6.16);
  const cap = (n: number) => n * MS;
  return (
    <>
      <rect width={MW} height={CARD_SIZE.mobile.h} fill="#fff" />
      <g transform={`scale(${MW / 50} ${MS})`}>
        {pandal ? (
          <>
            <path d="M0 0H50V8.46C26.77 2.77 23.23 2.77 0 8.46Z" fill={c.band} />
            <path d="M0 8.46C23.23 2.77 26.77 2.77 50 8.46V9.71C26.77 3.24 23.23 3.24 0 9.71Z" fill={c.stripe} />
          </>
        ) : (
          <>
            <path d="M0 0H50V4.66C26.77 8.78 23.23 8.78 0 4.66Z" fill={c.band} />
            <path d="M0 4.66C23.23 8.78 26.77 8.78 50 4.66V5.35C26.77 10.06 23.23 10.06 0 5.35Z" fill={c.stripe} />
          </>
        )}
      </g>
      <Logo s={MOBILE_LOGO} color={c.logo} />

      <MobileHeading pandal={pandal} tone={tone} />

      {MOBILE_ROWS.map((r) => (
        <g key={r.key}>
          <Value t={r.label} f={NARROW} cap={cap(2.11)} x={ML(3)} y={MY(r.y)} scale={k} />
          <Fixed t=":" f={NARROW} cap={cap(2.11)} x0={ML(11.03)} x1={ML(11.35)} y={MY(r.y)} />
          <Value t={upper(p[r.key])} f={NARROW} cap={cap(2.11)} x={ML(12.32)} y={MY(r.y)} scale={k} max={MR(r.end) - ML(12.32)} />
        </g>
      ))}

      {/* The QR code 2.6 higher (beside Dept. now) and the signature larger under it (the owner, 2026-11-18). */}
      {code && <Qr text={code} x={MR(37.4)} y={MY(37.2)} size={cap(10)} pad={0} />}

      <Fixed t="Sr. No." f={NARROW} cap={cap(2.7)} x0={ML(2)} x1={ML(10.26)} y={MY(53)} />
      <Value t={serialText(p.serial, 4)} f={NARROW} cap={cap(4.06)} x={ML(11.65)} y={MY(53.4)} scale={scaleFor('0001', NARROW, 4.06, 10.53)} max={cap(17.5)} />
      {/* Larger still (the owner, 2026-11-18: "increase size more"): 14.4 × 7.1, centred over "Auth Signatory", which moves down to make room. */}
      <Signature href={texts.signature} x={MR(34.2)} y={MY(47.8)} w={cap(14.4)} h={cap(7.1)} />
      <Fixed t="Auth Signatory" f={NARROW} cap={cap(1.42)} x0={MR(35.4)} x1={MR(47.4)} y={MY(56.3)} />

      {/* The bottom band, with no grey line over it (taken off 2026-11-15). */}
      <rect y={MY(57.17)} width={MW} height={CARD_SIZE.mobile.h - MY(57.17)} fill={c.band} />
      {/* The tab stands on the band in the band's own colour (owner, 2026-11-15: "use same as bottom border"). */}
      <TagTab t={texts.tag} cx={MW / 2} base={MY(57.17)} cap={cap(1.62)} max={cap(12.8)} into={0} fill={c.band} letters="white" />
    </>
  );
}

/*
 * ---------- Bike pass: 145 × 99 mm ----------
 * Drawn on the 88 × 60 mm template and printed 1.65 times as big (2026-11-15; 100 × 68 the day before):
 * the same shape, so nothing moves.
 */

const BIKE_ROWS = [
  { label: 'Name', end: 9.76, key: 'name', y: 28.3 },
  { label: 'Department :', end: 18.71, key: 'dept', y: 34.1 },
  { label: 'Area :', end: 9.92, key: 'area', y: 39.85 },
  { label: 'Veh. Reg No.', end: 17.89, key: 'vehicle_no', y: 45.6 },
] as const;
const LINE_END = 66.8;

/**
 * Variants (drawn in ../passes-design-v2; the owner picked `ledger` on 2026-11-15, the printed Bike pass):
 *   plate:  the Reg. No. large, in a white number plate with a black border, where its row was;
 *   ledger: the plate, and every label small above its value, as on the Gate 3 Entry pass (Ledger),
 *           Department and Area side by side.
 */
type BikeVariant = 'plate' | 'ledger';

/** A label small above its value, as on the Ledger. */
function LedgerLabel({ t, x, y, align }: { t: string; x: number; y: number; align?: 'start' | 'end' }) {
  return <Text t={t} f={LABEL_FONT} cap={1.45} x={x} y={y} align={align} track={1.45 * 0.12} fill={INK} />;
}

/** A Ledger field: the label, its value under it, a rule under that. `y`: the label's baseline. */
function LedgerField({ label, v, x0, x1, y }: { label: string; v: string; x0: number; x1: number; y: number }) {
  return (
    <g>
      <LedgerLabel t={label} x={x0} y={y} />
      <Value t={upper(v)} f={NARROW} cap={2.9} x={x0} y={y + 3.9} max={x1 - x0} />
      <rect x={x0} y={y + 4.5} width={x1 - x0} height={0.17} fill={RULE} />
    </g>
  );
}

/** The ledger variant's fields: label, value, rule; Department and Area share a row; the Reg. No. in a plate. */
function BikeLedgerFields({ p }: { p: CardProps['p'] }) {
  return (
    <g>
      <LedgerField label="NAME" v={p.name} x0={3.25} x1={LINE_END} y={25.4} />
      <LedgerField label="DEPT." v={p.dept} x0={3.25} x1={26.5} y={33} />
      <LedgerField label="AREA" v={p.area} x0={29} x1={LINE_END} y={33} />
      <LedgerLabel t="VEH. REG. NO." x={3.25} y={40.8} />
      <rect x={3.25} y={41.8} width={LINE_END - 3.25} height={8.6} rx={1.2} fill="#fff" stroke={INK} strokeWidth={0.35} />
      <Value t={upper(p.vehicle_no)} f={NARROW_HEAVY} cap={5.4} x={(3.25 + LINE_END) / 2} y={41.8 + 4.3 + 2.7} align="middle" max={LINE_END - 3.25 - 3} fill={INK} />
    </g>
  );
}

/** `white`: a white body under the coloured header (a variant; the motorbike then in the pass's tint). */
function BikeCard({ p, texts, code, variant, white = false }: CardProps & { variant?: BikeVariant; white?: boolean }) {
  const c = TYPE_INFO[p.type].color;
  const pandal = p.type === 'bike-pandal';
  const rows = variant === 'plate' ? BIKE_ROWS.filter((r) => r.key !== 'vehicle_no') : variant === 'ledger' ? [] : BIKE_ROWS;
  const k = scaleFor('Name', NARROW, 2.28, 9.76 - 3.25);
  return (
    <g transform={`scale(${CARD_SIZE.bike.w / 88} ${CARD_SIZE.bike.h / 60})`}>
      <rect width={88} height={60} fill={white ? '#fff' : c.bg} />
      <rect width={88} height={9.5} fill={c.band} />
      <rect y={9.5} width={88} height={0.65} fill={c.stripe} />
      {/* The bottom band, with no grey line over it (taken off 2026-11-15). */}
      <rect y={57.15} width={88} height={2.85} fill={c.band} />
      <Motorbike transform="translate(21.5 23.7) scale(0.423)" stroke={white ? c.bg : '#fff'} />

      <Logo s={BIKE_LOGO} color={c.logo} />
      <Fixed t="RSSB SIKANDERPUR (MC)" f={NARROW_HEAVY} cap={5.36} x0={15.29} x1={85.72} y={7.64} fill="#fff" />
      {pandal
        ? <Fixed t="PANDAL" f={NARROW_HEAVY} cap={4.22} x0={37.09} x1={56.77} y={15.28} />
        : <Fixed t="NON PANDAL" f={NARROW_HEAVY} cap={4.22} x0={30.58} x1={63.28} y={15.28} />}
      <Fixed t="TWO WHEELER PASS" f={NARROW_HEAVY} cap={4.55} x0={20.98} x1={72.87} y={21.46} />
      {code && <Qr text={code} x={74.1} y={15.5} size={13} pad={0.6} />}
      <Zone dashes={[69.94, 71.41, 84.75, 86.37]} text={[73.36, 82.79]} cap={2.11} y={13.17} thick={0.22} />

      {rows.map((r) => (
        <g key={r.key}>
          <Fixed t={r.label} f={NARROW} cap={2.28} x0={3.25} x1={r.end} y={r.y} />
          <rect x={r.end + 1} y={r.y + 0.22} width={LINE_END - r.end - 1} height={0.17} fill={RULE} />
          <Value t={upper(p[r.key])} f={NARROW} cap={2.6} x={r.end + 2} y={r.y - 0.1} scale={k} max={LINE_END - r.end - 2.5} />
        </g>
      ))}

      <Fixed t="Sr. No." f={NARROW} cap={2.6} x0={73.2} x1={81.66} y={35.45} />
      <Value t={serialText(p.serial, 3)} f={NARROW} cap={6.5} x={77.43} y={44.55} align="middle" scale={scaleFor('001', NARROW, 6.5, 10.73)} max={15} />

      <Signature href={texts.signature} x={68.9} y={45.7} w={16} h={7.3} />
      <rect x={66.69} y={53.06} width={19.36} height={0.16} fill={INK} />
      <Fixed t="Auth Signatory" f={NARROW} cap={2.03} x0={68.16} x1={84.75} y={55.9} />
      {variant === 'ledger' && <BikeLedgerFields p={p} />}
      {variant === 'plate' && (
        <g>
          <rect x={3.25} y={42.2} width={LINE_END - 3.25} height={8.4} rx={1.2} fill="#fff" stroke={INK} strokeWidth={0.35} />
          <Value t="Veh. Reg No." f={NARROW} cap={2} x={5} y={47.4} />
          <Value t={upper(p.vehicle_no)} f={NARROW_HEAVY} cap={5} x={20.5} y={48.9} max={LINE_END - 20.5 - 1.5} fill={INK} />
        </g>
      )}
      {/* The tab stands on the band in the band's own colour, as on Mobile passes. */}
      <TagTab t={texts.tag} cx={44} base={57.15} cap={3} max={26} into={0} fill={c.band} letters="white" />
    </g>
  );
}

/**
 * The Bike pass laid out again, with less on each line (variants for ../passes-design-v2, not printed):
 * white body under the coloured header; the fields across the whole width with Ledger labels; along the
 * bottom the QR code at the left, the Reg. No. plate in the middle and the signature at the right. No
 * motorbike drawing. `head`, the top:
 *   pill:   the logo hanging from the band; beside it TWO WHEELER PASS in a pill and ZONE-III, then
 *           PANDAL large; Sr. No. at the top right (round 18);
 *   label:  the logo hanging from the band, ZONE-III at the band's right end; beside the logo a label
 *           over PANDAL and, at the right, a label over the Sr. No., as the fields are (round 19);
 *   band:   the logo inside a deeper band, ZONE-III under the name; then the label-over-value pair from
 *           the fields' left edge (round 19);
 *   centre: as pill, with the pill and PANDAL centred on the pass, on the same line down the middle as
 *           the plate and the month tab; — ZONE-III — at the top right as on the printed pass, the
 *           Sr. No. under it (round 20).
 * `monthUp` (label and band): the month in a white pill at the band's right instead of the tab at the
 * bottom; the band 12.5 deep, ZONE-III under the name (round 21).
 */
type BikeHead = 'pill' | 'label' | 'band' | 'centre';
/** The logo inside the deeper band ('band'), the same shape as BIKE_LOGO. */
const BAND_LOGO: LogoSpec = { frame: [2.8, 1.3, 11.1, 11.2], line: [3.25, 1.75, 10.65, 10.75] };

function BikeTidy({ p, texts, code, head = 'pill', monthUp = false }: CardProps & { head?: BikeHead; monthUp?: boolean }) {
  const c = TYPE_INFO[p.type].color;
  const pandal = p.type === 'bike-pandal';
  const tone = pandal ? c.band : TONE_GREY;
  const [x0, x1] = [3.25, 84.75];
  const kind = pandal ? 'PANDAL' : 'NON PANDAL';
  const serial = (cap: number, y: number) => (
    <Value t={serialText(p.serial, 3)} f={NARROW} cap={cap} x={x1} y={y} align="end" scale={scaleFor('001', NARROW, cap, (10.73 * cap) / 6.5)} max={15} />
  );
  /** A label over a large value, as the fields are: the pass's kind at `x`, the Sr. No. at the right. */
  const pair = (x: number, y: number, cap: number) => (
    <g>
      <LedgerLabel t="TWO WHEELER PASS" x={x} y={y} />
      <Text t={kind} f={NARROW_BLACK} cap={cap} x={x} y={y + 1 + cap} max={48} fill={INK} />
      <LedgerLabel t="SR. NO." x={x1} y={y} align="end" />
      {serial(cap, y + 1 + cap)}
    </g>
  );
  const zone = (y: number, cap: number, x: number, align: 'start' | 'end') => (
    <Text t="ZONE-III" f={LABEL_FONT} cap={cap} x={x} y={y} align={align} track={cap * 0.12} fill="#fff" />
  );
  const label = 1.65;
  const track = label * 0.22;
  const pw = widthOf('TWO WHEELER PASS', NARROW_HEAVY, label, track) + 3.2 * 1.2;
  /** The pill: TWO WHEELER PASS, white on the pass colour. */
  const pill = { x: head === 'centre' ? 44 - pw / 2 : 15.8, y: 11.3, h: 3.2, w: pw };
  const line = pill.y + pill.h / 2 + 1.45 / 2;
  const zw = widthOf('ZONE-III', LABEL_FONT, 1.9, 1.9 * 0.12);
  /** The month, white pill at the band's right ('monthUp'). */
  const month = upper(texts.tag);
  const mp = { cap: 3, h: 6.4, w: widthOf(month, NARROW_BLACK, 3) + 3.2 };
  const nameX = head === 'band' ? 13.2 : 15.8;
  const top = monthUp ? (
    <g>
      <rect width={88} height={12.5} fill={c.band} />
      <Logo s={head === 'band' ? BAND_LOGO : BIKE_LOGO} color={c.logo} />
      <Text t="RSSB SIKANDERPUR (MC)" f={NARROW_HEAVY} cap={4} x={nameX} y={6.6} max={x1 - (month ? mp.w + 2.5 : 0) - nameX} fill="#fff" />
      {zone(10.2, 1.7, nameX, 'start')}
      {month && (
        <g>
          <rect x={x1 - mp.w} y={(12.5 - mp.h) / 2} width={mp.w} height={mp.h} rx={mp.h / 2} fill="#fff" />
          <Text t={month} f={NARROW_BLACK} cap={mp.cap} x={x1 - mp.w / 2} y={12.5 / 2 + mp.cap / 2} align="middle" fill={tone} />
        </g>
      )}
      {head === 'band' ? pair(x0, 15.4, 4.8) : pair(15.8, 15.9, 4.8)}
    </g>
  ) : head === 'label' ? (
    <g>
      <rect width={88} height={9.5} fill={c.band} />
      <Logo s={BIKE_LOGO} color={c.logo} />
      <Text t="RSSB SIKANDERPUR (MC)" f={NARROW_HEAVY} cap={4.6} x={15.8} y={7.05} max={x1 - zw - 3 - 15.8} fill="#fff" />
      {zone(7.05, 1.9, x1, 'end')}
      {pair(15.8, 15, 5.4)}
    </g>
  ) : head === 'band' ? (
    <g>
      <rect width={88} height={12.5} fill={c.band} />
      <Logo s={BAND_LOGO} color={c.logo} />
      <Text t="RSSB SIKANDERPUR (MC)" f={NARROW_HEAVY} cap={4} x={13.2} y={6.6} max={x1 - 13.2} fill="#fff" />
      {zone(10.2, 1.7, 13.2, 'start')}
      {pair(x0, 15.4, 4.8)}
    </g>
  ) : (
    <g>
      <rect width={88} height={9.5} fill={c.band} />
      <rect y={9.5} width={88} height={0.65} fill={c.stripe} />
      <Logo s={BIKE_LOGO} color={c.logo} />
      <Fixed t="RSSB SIKANDERPUR (MC)" f={NARROW_HEAVY} cap={5.36} x0={15.29} x1={85.72} y={7.64} fill="#fff" />
      <rect x={pill.x} y={pill.y} width={pill.w} height={pill.h} rx={pill.h / 2} fill={tone} />
      <Text t="TWO WHEELER PASS" f={NARROW_HEAVY} cap={label} x={pill.x + pill.w / 2} y={pill.y + pill.h / 2 + label / 2} align="middle" track={track} fill="#fff" />
      {head === 'centre' ? (
        <>
          <Text t={kind} f={NARROW_BLACK} cap={5.4} x={44} y={21.9} align="middle" max={40} fill={INK} />
          <Zone dashes={[69.94, 71.41, 84.75, 86.37]} text={[73.36, 82.79]} cap={2.11} y={line + 0.3} thick={0.22} />
          <LedgerLabel t="SR. NO." x={x1 - (10.73 * 5.4) / 6.5 - 1.2} y={21.9} align="end" />
          {serial(5.4, 21.9)}
        </>
      ) : (
        <>
          <LedgerLabel t="ZONE-III" x={pill.x + pill.w + 2} y={line} />
          <Text t={kind} f={NARROW_BLACK} cap={5.4} x={pill.x} y={21.9} max={48} fill={INK} />
          <LedgerLabel t="SR. NO." x={x1} y={line} align="end" />
          {serial(6.5, 21.9)}
        </>
      )}
    </g>
  );
  const plate = { x: 21, y: 42.6, w: 46, h: 8.2 };
  return (
    <g transform={`scale(${CARD_SIZE.bike.w / 88} ${CARD_SIZE.bike.h / 60})`}>
      <rect width={88} height={60} fill="#fff" />
      <rect y={57.15} width={88} height={2.85} fill={c.band} />
      {top}

      <LedgerField label="NAME" v={p.name} x0={x0} x1={x1} y={25.6} />
      <LedgerField label="DEPT." v={p.dept} x0={x0} x1={38} y={33.2} />
      <LedgerField label="AREA" v={p.area} x0={41} x1={x1} y={33.2} />

      {code && <Qr text={code} x={x0} y={plate.y} size={13} pad={0} />}
      <LedgerLabel t="VEH. REG. NO." x={plate.x} y={plate.y - 1} />
      <rect x={plate.x} y={plate.y} width={plate.w} height={plate.h} rx={1.2} fill="#fff" stroke={INK} strokeWidth={0.35} />
      <Value t={upper(p.vehicle_no)} f={NARROW_HEAVY} cap={4.8} x={plate.x + plate.w / 2} y={plate.y + plate.h / 2 + 2.4} align="middle" max={plate.w - 6} fill={INK} />

      <Signature href={texts.signature} x={68.9} y={45.7} w={16} h={7.3} />
      <rect x={66.69} y={53.06} width={19.36} height={0.16} fill={INK} />
      <Fixed t="Auth Signatory" f={NARROW} cap={2.03} x0={68.16} x1={84.75} y={55.9} />
      {!monthUp && <TagTab t={texts.tag} cx={44} base={57.15} cap={3} max={26} into={0} fill={c.band} letters="white" />}
    </g>
  );
}
/** The Bike pass laid out again (BikeTidy): variants for ../passes-design-v2 (not printed). */
export const BikeCardTidy = (props: CardProps) => <BikeTidy {...props} />;
export const BikeCardTidyLabel = (props: CardProps) => <BikeTidy {...props} head="label" />;
export const BikeCardTidyBand = (props: CardProps) => <BikeTidy {...props} head="band" />;
export const BikeCardTidyCentre = (props: CardProps) => <BikeTidy {...props} head="centre" />;
export const BikeCardTidyLabelMonth = (props: CardProps) => <BikeTidy {...props} head="label" monthUp />;
export const BikeCardTidyBandMonth = (props: CardProps) => <BikeTidy {...props} head="band" monthUp />;

/** The Bike pass with the Reg. No. in a number plate: a variant for ../passes-design-v2 (not printed). */
export const BikeCardPlate = (props: CardProps) => <BikeCard {...props} variant="plate" />;
/** The Bike pass as it prints (from 2026-11-15): the plate, and Ledger labels above the values. */
export const BikeCardLedger = (props: CardProps) => <BikeCard {...props} variant="ledger" />;
/** BikeCardLedger on a white body under the coloured header: a variant for ../passes-design-v2 (not printed). */
export const BikeCardWhite = (props: CardProps) => <BikeCard {...props} variant="ledger" white />;

/*
 * ---------- Sewa Vehicle / Tractor Trolley pass (v1): 204 × 145 mm ----------
 * Laid out on 150 × 100 and drawn on 150 × VH (vehicleBox.ts): the y's go through Y, which spreads the
 * extra height between the top and bottom bands.
 */

const VALUE_X = 68.6;
/** `max`: room for the value; Area and Dept end before the QR code. */
const VEHICLE_ROWS = [
  { label: 'Name :', end: 60.05, key: 'name', y: 44.58, max: 146 - VALUE_X },
  { label: 'Vehicle :', end: 63.51, key: 'vehicle', y: 52.18, max: 146 - VALUE_X },
  { label: 'Reg. No. :', end: 66.56, key: 'vehicle_no', y: 59.78, max: 146 - VALUE_X },
  { label: 'Area :', end: 57, key: 'area', y: 67.38, max: 130.6 - VALUE_X },
  { label: 'Dept. :', end: 58.99, key: 'dept', y: 74.98, max: 130.6 - VALUE_X },
] as const;

function VehicleCard({ p, texts, code }: CardProps) {
  const info = TYPE_INFO[p.type];
  const c = info.color;
  const tractor = p.type === 'tractor-trolley';
  const k = scaleFor('Name :', SANS, 3.84, 60.05 - 43.45);
  const Y = stretchY(7, 93.05);
  /** Moves a group of fixed size whose middle is at `y`. */
  const at = (y: number) => `translate(0 ${shiftOf(Y, y)})`;
  return (
    <>
      <rect width={VW} height={VH} fill="#fff" />
      <rect width={150} height={5.4} fill={c.band} />
      <rect y={5.5} width={150} height={1.4} fill={c.stripe} />

      {/* The template's heading was RADHA SOAMI SATSANG, BEAS (2.92 → 146.68): same lettering, centred. */}
      <Value t="RSSB SIKANDERPUR (MC)" f={HUMANIST} cap={7.67} x={75} y={Y(16.53)} align="middle"
        scale={scaleFor('RADHA SOAMI SATSANG, BEAS', HUMANIST, 7.67, 146.68 - 2.92)} />
      <Zone dashes={[119.04, 122.1, 144.55, 147.48]} text={[125.16, 141.36]} cap={3.96} y={Y(22.88)} thick={0.4} />
      {/* Template titles fill 39.46 → 148.27; other titles keep the Sewa lettering and end at the same place. */}
      {p.type === 'sewa-vehicle' || tractor
        ? <Fixed t={info.title} f={NARROW_BLACK} cap={10.05} x0={39.46} x1={148.27} y={Y(35.71)} fill={RED} />
        : <Value t={info.title} f={NARROW_BLACK} cap={10.05} x={148.27} y={Y(35.71)} align="end" max={148.27 - 39.46}
            scale={scaleFor('SEWA VEHICLE PASS', NARROW_BLACK, 10.05, 148.27 - 39.46)} fill={c.title ?? RED} />}

      {tractor ? (
        <>
          <g transform={`translate(9.63 ${Y(22.17)}) scale(0.667) translate(-6.64 -30.29)`}>
            <Logo s={VEHICLE_LOGO} color={c.logo} />
          </g>
          <Tractor transform={`translate(1.11 ${Y(46.97)}) scale(0.385)`} />
        </>
      ) : (
        <g transform={at(44.45)}><Logo s={VEHICLE_LOGO} color={c.logo} /></g>
      )}

      <rect x={39.6} y={Y(37.43)} width={108.27} height={Y(79.63) - Y(37.43)} rx={3.3} fill="#fff" stroke={INK} strokeWidth={0.27} />
      <rect x={40.39} y={Y(38.49)} width={106.69} height={Y(78.57) - Y(38.49)} rx={2.5} fill="#e6e7e8" stroke={INK} strokeWidth={0.27} />
      <g transform={at(57.08)}><Logo s={WATERMARK} color="#fff" letters="#d9dadb" /></g>
      {VEHICLE_ROWS.map((r) => (
        <g key={r.key}>
          <Fixed t={r.label} f={SANS} cap={3.84} x0={43.45} x1={r.end} y={Y(r.y)} />
          <Value t={upper(p[r.key])} f={SANS} cap={3.84} x={VALUE_X} y={Y(r.y)} scale={k} max={r.max} />
        </g>
      ))}
      {code && <Qr text={code} x={131.8} y={Y(69) - 7} size={14} pad={0.7} />}

      <Fixed t="Sr. No." f={NARROW} cap={3.96} x0={3.99} x1={16.21} y={Y(88.62)} />
      <Value t={serialText(p.serial, 3)} f={NARROW} cap={8.46} x={19.93} y={Y(89.81)} scale={scaleFor('001', NARROW, 8.46, 19.8)} max={30} />

      <rect y={Y(93.05)} width={VW} height={1.4} fill={c.stripe} />
      <rect y={Y(94.45)} width={VW} height={VH - Y(94.45)} fill={c.band} />
      <TagTab t={texts.tag} cx={75} base={Y(93.05)} cap={TAG_CAP} max={42} into={0.6} fill={c.stripe} />

      <Signature href={texts.signature} x={121.3} y={Y(87.8) - 8.6} w={25} h={8.6} />
      <rect x={119.71} y={Y(87.83)} width={27.23} height={0.13} fill={INK} />
      <Fixed t="Auth Signatory" f={NARROW} cap={2.96} x0={121.97} x1={145.08} y={Y(91.85)} />
    </>
  );
}

type Card = (props: CardProps) => React.JSX.Element;
const CARDS: Record<Layout, Card> = { mobile: MobileCard, bike: BikeCardLedger, vehicle: VehicleCard, gate: VehicleCard, large: HelplineVehicle };
/** Sheets printed in a design v2 pass instead of their layout's template. */
const BY_TYPE: Partial<Record<PassType, Card>> = {
  'vip-gate': TicketVehicle, admin: RailVehicle, 'bav-entry': RailVehicle, 'gate3-entry': LedgerVehicle,
  /** Design round 11 (Modern.tsx), picked 2026-11-15. */
  'sewa-vehicle': (props) => <ModernVehicle {...props} style="band" />,
  'tractor-trolley': (props) => <ModernVehicle {...props} style="plain" />,
};

/**
 * One pass, all vector, as an SVG group in mm (a whole sheet is one SVG). Draw only once
 * `useCardFonts()` is true. Blank fields are left empty to be filled in by hand.
 * `turn`: turned a quarter clockwise, filling the h × w spot whose top-left corner is (x, y).
 * `outline`: a grey line round the pass (off on a printed sheet, which draws its own cut lines).
 */
export const PassCard = memo(function PassCard({ p, texts, code, x = 0, y = 0, turn = false, outline = true }: CardProps & {
  x?: number; y?: number; turn?: boolean; outline?: boolean;
}) {
  const layout = TYPE_INFO[p.type].layout;
  const Card = BY_TYPE[p.type] ?? CARDS[layout];
  const { w, h } = CARD_SIZE[layout];
  /** Vehicle, gate and large passes are drawn VW wide (vehicleBox.ts) and printed CARD_SIZE[layout].w wide. */
  const k = layout === 'mobile' || layout === 'bike' ? 1 : w / VW;
  const transform = turn ? `translate(${x + h} ${y}) rotate(90)` : x || y ? `translate(${x} ${y})` : undefined;
  return (
    <g transform={transform}>
      {k === 1 ? <Card p={p} texts={texts} code={code} /> : <g transform={`scale(${k})`}><Card p={p} texts={texts} code={code} /></g>}
      {outline && <rect width={w} height={h} fill="none" stroke="#c8c8c8" strokeWidth={0.1} />}
    </g>
  );
});
