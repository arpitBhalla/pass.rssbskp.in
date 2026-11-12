'use client';
import { memo, type SVGProps, useEffect, useState } from 'react';
import { type Font, inkWidth, layLine, loadFonts, type Placed, placeText, scaleFor } from '@/client/measure';
import { condensed, heavy, humanist } from '@/fonts';
import type { CardData } from '@/lib/passes';
import { CARD_SIZE } from '@/lib/sheets';
import { type Layout, TYPE_INFO } from '@/shared/types';
import { Motorbike, Tractor } from './art';
import { Qr } from './Qr';

/**
 * The three RSSB SKP pass templates (Downloads/passes-template), redrawn as vectors in mm. Every
 * position, size and colour below was measured on the templates. Static text is fitted to the
 * template's exact ink box; filled-in values use the template's lettering width and shrink to fit.
 *
 * v1 (2026-11-11), the user's changes to the templates: the tab with the tag ("NOV - 2026") on every
 * pass, "RSSB SIKANDERPUR-M.C." as the heading of the 150 × 100 mm passes, and no "Valid For" line on
 * Bike passes. To make room for the tab, Mobile's rows, QR, Sr. No. and signature sit 1–4 mm higher
 * than on the template, and Bike's signature 0.6 mm higher.
 */

/** The design version, kept here only (not printed). Raise it when the design changes. */
export const TEMPLATE_VERSION = 'v1';

/** Shared by every desk: set once in Settings. */
export interface PrintTexts {
  signature: string;
  /** The tab at the bottom of every pass, e.g. "NOV - 2026". */
  tag: string;
}

const INK = '#231f20';
const GREY = '#939598';
const DARK = '#414042';
const RED = '#9e0b0f';
const RULE = '#6d6e71';
/** The tab grey of the 150 × 100 mm template (same as its stripe). */
const TAB_GREY = '#bcbec0';

const NARROW: Font = { family: condensed.style.fontFamily, weight: 700 };
const NARROW_HEAVY: Font = { family: condensed.style.fontFamily, weight: 800 };
const NARROW_BLACK: Font = { family: condensed.style.fontFamily, weight: 900 };
const HUMANIST: Font = { family: humanist.style.fontFamily, weight: 600 };
const SANS: Font = { family: 'Tahoma, Verdana, "DejaVu Sans", sans-serif', weight: 700 };
const SERIF: Font = { family: 'Georgia, "Times New Roman", serif', weight: 400 };
const BLACK: Font = { family: heavy.style.fontFamily, weight: 400 };
const FONTS = [NARROW, NARROW_HEAVY, NARROW_BLACK, HUMANIST, SANS, SERIF, BLACK];

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
  /** Outer edges of the outline, and its thickness. */
  line: Box;
  stroke: number;
  fill: Box;
  /** Letters: ink from x0 to x1, cap height, baselines of RS and SB. */
  letters: { x0: number; x1: number; cap: number; rs: number; sb: number };
}

function Logo({ s, color, letters = '#fff', line = color }: { s: LogoSpec; color: string; letters?: string; line?: string }) {
  const [lx0, ly0, lx1, ly1] = s.line;
  const [fx0, fy0, fx1, fy1] = s.fill;
  const h = s.stroke / 2;
  const l = s.letters;
  return (
    <g>
      {s.frame && <rect x={s.frame[0]} y={s.frame[1]} width={s.frame[2] - s.frame[0]} height={s.frame[3] - s.frame[1]} fill="#fff" />}
      <rect x={lx0 + h} y={ly0 + h} width={lx1 - lx0 - s.stroke} height={ly1 - ly0 - s.stroke} fill="none" stroke={line} strokeWidth={s.stroke} />
      <rect x={fx0} y={fy0} width={fx1 - fx0} height={fy1 - fy0} fill={color} />
      <Fixed t="RS" f={SERIF} cap={l.cap} x0={l.x0} x1={l.x1} y={l.rs} fill={letters} />
      <Fixed t="SB" f={SERIF} cap={l.cap} x0={l.x0} x1={l.x1} y={l.sb} fill={letters} />
    </g>
  );
}

const MOBILE_LOGO: LogoSpec = {
  frame: [25.57, 1.08, 37.93, 15.74], line: [26.05, 1.56, 37.45, 15.26], stroke: 0.36, fill: [27.01, 2.64, 36.49, 14.3],
  letters: { x0: 28.75, x1: 34.87, cap: 3.5, rs: 7.85, sb: 12.3 },
};
const BIKE_LOGO: LogoSpec = {
  frame: [1.83, 1.5, 13.3, 15.73], line: [2.28, 1.95, 12.85, 15.28], stroke: 0.33, fill: [3.25, 3.09, 12.04, 14.47],
  letters: { x0: 4.88, x1: 10.57, cap: 3.58, rs: 8.13, sb: 12.85 },
};
const VEHICLE_LOGO: LogoSpec = {
  line: [6.64, 30.29, 29.89, 58.6], stroke: 0.7, fill: [8.77, 32.54, 27.9, 56.61],
  letters: { x0: 12.22, x1: 24.84, cap: 7.81, rs: 43.39, sb: 53.44 },
};
/** The faint logo inside the details box of vehicle passes. */
const WATERMARK: LogoSpec = {
  line: [91.01, 43.25, 113.6, 70.9], stroke: 0.66, fill: [93, 45.37, 111.74, 69.05],
  letters: { x0: 96.43, x1: 108.69, cap: 7.6, rs: 56.04, sb: 65.86 },
};

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
 * (same colour, so no seam). Text over `max` mm shrinks.
 */
function TagTab({ t, cx, base, cap, max, into, fill }: { t: string; cx: number; base: number; cap: number; max: number; into: number; fill: string }) {
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
      <Value t={tag} f={BLACK} cap={cap} x={cx} y={base - 1.12 * k} align="middle" scale={scale} max={max}
        fill="#fff" stroke={DARK} strokeWidth={0.32 * k} paintOrder="stroke" strokeLinejoin="round" />
    </g>
  );
}

interface CardProps {
  p: CardData;
  texts: PrintTexts;
  /** The pass's code from the server (44 digits), printed as its QR code; none: no QR. */
  code?: string;
}

/* ---------- Mobile pass: 63.5 × 88.9 mm (9 per A4) ---------- */

/** `max`: room for the value; Area and Phone stop 2 mm short of the QR code (its quiet zone). */
const MOBILE_ROWS = [
  { label: 'NAME', key: 'name', y: 50.6, max: 43 },
  { label: 'DEPT', key: 'dept', y: 56.8, max: 43 },
  { label: 'AREA', key: 'area', y: 63, max: 29.4 },
  { label: 'PHONE', key: 'phone', y: 69.2, max: 29.4 },
] as const;

function MobileCard({ p, texts, code }: CardProps) {
  const c = TYPE_INFO[p.type].color;
  const pandal = p.type === 'mobile-pandal';
  const k = scaleFor('NAME', NARROW, 3.12, 13.32 - 4.2);
  return (
    <>
      <rect width={63.5} height={88.9} fill="#fff" />
      {pandal ? (
        <>
          <path d="M0 0H63.5V12.53C34 4.1 29.5 4.1 0 12.53Z" fill={c.band} />
          <path d="M0 12.53C29.5 4.1 34 4.1 63.5 12.53V14.39C34 4.8 29.5 4.8 0 14.39Z" fill={c.stripe} />
        </>
      ) : (
        <>
          <path d="M0 0H63.5V6.9C34 13 29.5 13 0 6.9Z" fill={c.band} />
          <path d="M0 6.9C29.5 13 34 13 63.5 6.9V7.93C34 14.9 29.5 14.9 0 7.93Z" fill={c.stripe} />
        </>
      )}
      <Logo s={MOBILE_LOGO} color={c.logo} />

      <Fixed t="RSSB" f={SANS} cap={6.37} x0={16.21} x1={36.61} y={23.07} />
      <Fixed t="ZONE-III" f={SANS} cap={1.8} x0={37.81} x1={47.05} y={23.07} />
      <Fixed t="SIKANDERPUR - M.C." f={SANS} cap={3.48} x0={10.44} x1={52.82} y={28.47} fill={GREY} />
      <Fixed t="MOBILE PASS" f={SANS} cap={4.08} x0={14.4} x1={48.86} y={35.2} fill={GREY} />
      {pandal
        ? <Fixed t="PANDAL" f={SANS} cap={5.41} x0={16.69} x1={46.57} y={42.05} />
        : <Fixed t="NON PANDAL" f={SANS} cap={5.41} x0={7.08} x1={56.18} y={42.05} />}

      {MOBILE_ROWS.map((r) => (
        <g key={r.key}>
          <Value t={r.label} f={NARROW} cap={3.12} x={4.2} y={r.y} scale={k} />
          <Fixed t=":" f={NARROW} cap={3.12} x0={16.09} x1={16.57} y={r.y} />
          <Value t={upper(p[r.key])} f={NARROW} cap={3.12} x={18} y={r.y} scale={k} max={r.max} />
        </g>
      ))}

      {code && <Qr text={code} x={49.4} y={59} size={12} pad={0} />}

      <Fixed t="Sr. No." f={NARROW} cap={4} x0={2.04} x1={14.28} y={77.8} />
      <Value t={serialText(p.serial, 4)} f={NARROW} cap={6.01} x={16.33} y={78.4} scale={scaleFor('0001', NARROW, 6.01, 15.6)} max={26} />
      <Signature href={texts.signature} x={44.2} y={73} w={16.6} h={4.75} />
      <Fixed t="Auth Signatory" f={NARROW} cap={2.1} x0={43.09} x1={60.86} y={79.4} />

      <rect y={84.7} width={63.5} height={0.48} fill={c.stripe} />
      <rect y={85.18} width={63.5} height={3.72} fill={c.band} />
      {/* The tab is the template's grey (Non Pandal's stripe is too pale for it) and stands on the band. */}
      <TagTab t={texts.tag} cx={31.75} base={84.7} cap={2.4} max={19} into={0.48} fill={TAB_GREY} />
    </>
  );
}

/* ---------- Bike pass: 88 × 60 mm (8 per A4) ---------- */

const BIKE_ROWS = [
  { label: 'Name', end: 9.76, key: 'name', y: 28.3 },
  { label: 'Department :', end: 18.71, key: 'dept', y: 34.1 },
  { label: 'Area :', end: 9.92, key: 'area', y: 39.85 },
  { label: 'Veh. Reg No.', end: 17.89, key: 'vehicle_no', y: 45.6 },
] as const;
const LINE_END = 66.8;

function BikeCard({ p, texts, code }: CardProps) {
  const c = TYPE_INFO[p.type].color;
  const pandal = p.type === 'bike-pandal';
  const k = scaleFor('Name', NARROW, 2.28, 9.76 - 3.25);
  return (
    <>
      <rect width={88} height={60} fill={c.bg} />
      <rect width={88} height={9.5} fill={c.band} />
      <rect y={9.5} width={88} height={0.65} fill={c.stripe} />
      <rect y={57.15} width={88} height={0.65} fill={c.stripe} />
      <rect y={57.8} width={88} height={2.2} fill={c.band} />
      <Motorbike transform="translate(21.5 23.7) scale(0.423)" />

      <Logo s={BIKE_LOGO} color={c.logo} />
      <Fixed t="RSSB SIKANDERPUR-M.C." f={NARROW_HEAVY} cap={5.36} x0={15.29} x1={85.72} y={7.64} fill="#fff" />
      {pandal
        ? <Fixed t="PANDAL" f={NARROW_HEAVY} cap={4.22} x0={37.09} x1={56.77} y={15.28} />
        : <Fixed t="NON PANDAL" f={NARROW_HEAVY} cap={4.22} x0={30.58} x1={63.28} y={15.28} />}
      <Fixed t="TWO WHEELER PASS" f={NARROW_HEAVY} cap={4.55} x0={20.98} x1={72.87} y={21.46} />
      {code && <Qr text={code} x={74.1} y={15.5} size={13} pad={0.6} />}
      <Zone dashes={[69.94, 71.41, 84.75, 86.37]} text={[73.36, 82.79]} cap={2.11} y={13.17} thick={0.22} />

      {BIKE_ROWS.map((r) => (
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
      <TagTab t={texts.tag} cx={44} base={57.15} cap={3} max={26} into={0.3} fill={c.stripe} />
    </>
  );
}

/* ---------- Sewa Vehicle / Tractor Trolley / Gate 3 Entry / BAV Entry pass: 150 × 100 mm ---------- */

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
  return (
    <>
      <rect width={150} height={100} fill="#fff" />
      <rect width={150} height={5.4} fill={c.band} />
      <rect y={5.5} width={150} height={1.4} fill={c.stripe} />

      {/* The template's heading was RADHA SOAMI SATSANG, BEAS (2.92 → 146.68): same lettering, centred. */}
      <Value t="RSSB SIKANDERPUR-M.C." f={HUMANIST} cap={7.67} x={75} y={16.53} align="middle"
        scale={scaleFor('RADHA SOAMI SATSANG, BEAS', HUMANIST, 7.67, 146.68 - 2.92)} />
      <Zone dashes={[119.04, 122.1, 144.55, 147.48]} text={[125.16, 141.36]} cap={3.96} y={22.88} thick={0.4} />
      {/* Template titles fill 39.46 → 148.27; other titles keep the Sewa lettering and end at the same place. */}
      {p.type === 'sewa-vehicle' || tractor
        ? <Fixed t={info.title} f={NARROW_BLACK} cap={10.05} x0={39.46} x1={148.27} y={35.71} fill={RED} />
        : <Value t={info.title} f={NARROW_BLACK} cap={10.05} x={148.27} y={35.71} align="end" max={148.27 - 39.46}
            scale={scaleFor('SEWA VEHICLE PASS', NARROW_BLACK, 10.05, 148.27 - 39.46)} fill={c.title ?? RED} />}

      {tractor ? (
        <>
          <g transform="translate(9.63 22.17) scale(0.667) translate(-6.64 -30.29)">
            <Logo s={VEHICLE_LOGO} color={c.logo} />
          </g>
          <Tractor transform="translate(1.11 46.97) scale(0.385)" />
        </>
      ) : (
        <Logo s={VEHICLE_LOGO} color={c.logo} />
      )}

      <rect x={39.6} y={37.43} width={108.27} height={42.2} rx={3.3} fill="#fff" stroke={INK} strokeWidth={0.27} />
      <rect x={40.39} y={38.49} width={106.69} height={40.08} rx={2.5} fill="#e6e7e8" stroke={INK} strokeWidth={0.27} />
      <Logo s={WATERMARK} color="#fff" letters="#d9dadb" />
      {VEHICLE_ROWS.map((r) => (
        <g key={r.key}>
          <Fixed t={r.label} f={SANS} cap={3.84} x0={43.45} x1={r.end} y={r.y} />
          <Value t={upper(p[r.key])} f={SANS} cap={3.84} x={VALUE_X} y={r.y} scale={k} max={r.max} />
        </g>
      ))}
      {code && <Qr text={code} x={131.8} y={62} size={14} pad={0.7} />}

      <Fixed t="Sr. No." f={NARROW} cap={3.96} x0={3.99} x1={16.21} y={88.62} />
      <Value t={serialText(p.serial, 3)} f={NARROW} cap={8.46} x={19.93} y={89.81} scale={scaleFor('001', NARROW, 8.46, 19.8)} max={30} />

      <rect y={93.05} width={150} height={1.4} fill={c.stripe} />
      <rect y={94.45} width={150} height={5.55} fill={c.band} />
      <TagTab t={texts.tag} cx={75} base={93.05} cap={TAG_CAP} max={42} into={0.6} fill={c.stripe} />

      <Signature href={texts.signature} x={121.3} y={79.2} w={25} h={8.6} />
      <rect x={119.71} y={87.83} width={27.23} height={0.13} fill={INK} />
      <Fixed t="Auth Signatory" f={NARROW} cap={2.96} x0={121.97} x1={145.08} y={91.85} />
    </>
  );
}

const CARDS: Record<Layout, (props: CardProps) => React.JSX.Element> = { mobile: MobileCard, bike: BikeCard, vehicle: VehicleCard };

/**
 * One pass, all vector, as an SVG group in mm (a whole sheet is one SVG). Draw only once
 * `useCardFonts()` is true. Blank fields are left empty to be filled in by hand.
 * `turn`: turned a quarter clockwise, filling the h × w spot whose top-left corner is (x, y).
 */
export const PassCard = memo(function PassCard({ p, texts, code, x = 0, y = 0, turn = false }: CardProps & { x?: number; y?: number; turn?: boolean }) {
  const layout = TYPE_INFO[p.type].layout;
  const Card = CARDS[layout];
  const { w, h } = CARD_SIZE[layout];
  const transform = turn ? `translate(${x + h} ${y}) rotate(90)` : x || y ? `translate(${x} ${y})` : undefined;
  return (
    <g transform={transform}>
      <Card p={p} texts={texts} code={code} />
      {/* cut line */}
      <rect width={w} height={h} fill="none" stroke="#c8c8c8" strokeWidth={0.1} />
    </g>
  );
});
