/**
 * Line drawings for the passes, in the style of the templates' pictures. Drawn in a local box and
 * placed on the card with a transform (all vector).
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const at = (cx: number, cy: number, r: number, a: number) => `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`;

/** Slanted tread lugs between two radii of a tyre. */
function lugs(cx: number, cy: number, r0: number, r1: number, n: number, skew: number) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    d += `M${at(cx, cy, r0, a)}L${at(cx, cy, r1, a + skew)}`;
  }
  return d;
}

/** Spokes of a cast wheel, from the hub to the rim. */
function spokes(cx: number, cy: number, r0: number, r1: number, n: number) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    d += `M${at(cx, cy, r0, a)}L${at(cx, cy, r1, a)}`;
  }
  return d;
}

/** Commuter motorbike facing right: white outline, the watermark of the Bike passes. Local box 100 × 62. */
export function Motorbike({ transform }: { transform: string }) {
  const wheel = (cx: number) => (
    <>
      <circle cx={cx} cy={46} r={15.5} />
      <circle cx={cx} cy={46} r={12} />
      <circle cx={cx} cy={46} r={2.6} />
      <path d={spokes(cx, 46, 2.6, 12, 5)} />
    </>
  );
  return (
    <g transform={transform} fill="none" stroke="#fff" strokeWidth={0.85} strokeLinecap="round" strokeLinejoin="round" opacity={0.92}>
      {wheel(20)}
      {wheel(81)}
      <path d="M4 37C5 29 11 25.5 20 25.5C24 25.5 27 26.5 29 28" />
      <path d="M2 21.5H9V24.5H3ZM9 22H13" />
      <path d="M10 22.5C12 18.5 18 17.5 26 18L42 19C45 19.3 47 21 47.5 23.5L28 25C20 25.5 14 24.8 10 22.5Z" />
      <path d="M28 25L46 23.8L44.5 32.5L31 33Z" />
      <path d="M26.5 25.5L29.5 26.5L23.5 40.5L20.5 39.5Z" />
      <path d="M20 46L44 41.5M21.5 49L45 44.5" />
      <path d="M45 32.5L58 30.5L62.5 35.5L60.5 44L48.5 46L44.5 41ZM50 32.2L57.5 31M50.5 34.4L59 33.2M51 36.6L60 35.4" />
      <circle cx={53} cy={41.5} r={2.6} />
      <path d="M29.5 47L56 42.2C58.2 41.9 59 44.6 57 45.2L31.5 51C28.6 51.6 27.6 47.4 29.5 47Z" />
      <path d="M46 22.5C46.8 16 56 13.5 65.5 14C68.8 14.2 70 16.5 69.2 19.5L66.5 25.8C60.5 26.8 52.5 26.8 47.2 25.8ZM54 19.5H62" />
      <path d="M68.5 20.5L60.5 32.5M70 16.5L80 44.5M73 15.5L83 43.5" />
      <path d="M69.5 12.5C73.5 10.5 77.5 11.8 78.6 16.5C79.4 20.5 77.6 23 74.6 23.2L72 18ZM75.6 15.5C77.2 16 77.8 18 77.4 20" />
      <path d="M63.5 11L71 13.2M68.2 12.2L66.4 5" />
      <ellipse cx={65.9} cy={2.9} rx={1.8} ry={2.4} />
      <path d="M69.5 35C71.5 29.5 77.5 27.2 84 28C88 28.6 91.5 31 93 34.5M43 45.5H48.5" />
    </g>
  );
}

/** Farm tractor facing right: dark outline, for the Tractor Trolley passes. Local box 100 × 85. */
export function Tractor({ transform }: { transform: string }) {
  return (
    <g transform={transform} fill="#fff" stroke="#414042" strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round">
      {/* behind the wheels: seat, steering, bonnet, engine, exhaust */}
      <path d="M14 26.5L12.5 14Q12.3 11 15.3 11L18.8 11Q21.2 11 21.4 14L22.4 23" fill="none" />
      <path d="M13.5 27L35.5 27Q37.6 27 37 24.6L36.2 23L21.5 23Z" />
      <path d="M44.5 34L40.5 20" fill="none" />
      <ellipse cx={39.5} cy={18.6} rx={7} ry={2} transform="rotate(-12 39.5 18.6)" fill="none" />
      <path d="M37 27L45.5 29L47.5 52L40 52Z" />
      <path d="M45 29L86 31Q93 31.5 93.5 37L93.5 50L46.5 50Z" />
      <path d="M88.5 34.5V48M91 34V48M50 38H85M52 29.2V27.6H57V29.4" fill="none" />
      <path d="M50 50H86V59H74L70 62H54Z" />
      <path d="M55 53H68M55 56H66M78 59L80 66" fill="none" />
      <path d="M61.5 30.5V12Q61.5 6.5 65 5L66.2 7.6Q64.2 8.6 64.2 12V30.5Z" />
      <rect x={60.3} y={14} width={5.1} height={11} rx={1} />
      <circle cx={93.5} cy={41} r={2.4} />
      {/* rear wheel, its mudguard, front wheel */}
      <circle cx={26} cy={58} r={26} />
      <path d={lugs(26, 58, 21.5, 26, 28, 0.12)} fill="none" />
      <circle cx={26} cy={58} r={21.5} />
      <circle cx={26} cy={58} r={14} />
      <circle cx={26} cy={58} r={10.5} fill="none" />
      <circle cx={26} cy={58} r={4.5} />
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * 2 * Math.PI;
        return <circle key={i} cx={r2(26 + 7.3 * Math.cos(a))} cy={r2(58 + 7.3 * Math.sin(a))} r={0.9} />;
      })}
      <path d="M-2.1 44.9A31 31 0 0 1 54.1 44.9L51.8 46A28.5 28.5 0 0 0 0.2 46Z" />
      <circle cx={82} cy={70} r={14.5} />
      <path d={lugs(82, 70, 11.5, 14.5, 16, 0.15)} fill="none" />
      <circle cx={82} cy={70} r={11.5} />
      <circle cx={82} cy={70} r={7.5} />
      <circle cx={82} cy={70} r={2.6} />
    </g>
  );
}
