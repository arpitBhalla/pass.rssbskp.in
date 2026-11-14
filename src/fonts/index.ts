import localFont from 'next/font/local';

// Bundled so passes print the same on every desk. All are SIL Open Font License (see OFL.txt).
/** Roboto Condensed (variable 100–900): the condensed bold lettering of the pass templates; serial numbers on screen. */
export const condensed = localFont({ src: './RobotoCondensed-latin.woff2', weight: '100 900', display: 'block', variable: '--font-cond' });
/** Source Sans 3 (variable 200–900): the "RADHA SOAMI SATSANG, BEAS" heading. */
export const humanist = localFont({ src: './SourceSans3-latin.woff2', weight: '200 900', display: 'block' });
/** Atkinson Hyperlegible Next (variable 200–800): the app's own text. Made for legibility: 0/O and 1/l/I never look alike. */
export const legible = localFont({ src: './AtkinsonHyperlegibleNext-latin.woff2', weight: '200 800', display: 'swap', variable: '--font-ui' });
/** Archivo Black: the heavy "SKP-2026" tag. */
export const heavy = localFont({ src: './ArchivoBlack-latin.woff2', weight: '400', display: 'block' });

/* Design v2 passes (Gate 3 - VIP and Admin): see components/cards/v2kit.tsx. */
/** Rozha One: "RSSB SIKANDERPUR (MC)" and the RS/SB monogram. */
export const rozha = localFont({ src: './RozhaOne-400.woff2', weight: '400', display: 'block' });
/** Archivo SemiCondensed (static cuts at width 87.5): the Ticket's labels and values. */
export const archivoSemi = localFont({
  src: [
    { path: './Archivo-87.5-600.woff2', weight: '600' },
    { path: './Archivo-87.5-700.woff2', weight: '700' },
  ],
  display: 'block',
});
/** Martian Mono: Reg. No. and phone on the Ticket. */
export const martianMono = localFont({ src: './MartianMono-600.woff2', weight: '600', display: 'block' });
/** Big Shoulders Display 800: the serial on both v2 passes. */
export const bigShoulders = localFont({ src: './BigShouldersDisplay-800.woff2', weight: '800', display: 'block' });
