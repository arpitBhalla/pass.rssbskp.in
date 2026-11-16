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

/* Design v2 passes (Gate 3 - VIP, Admin and Gate 1 & 12 Entry): see components/cards/v2kit.tsx. */
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

/* Design v2 Gate 3 Entry pass (the Ledger): see components/cards/Ledger.tsx. */
/** Barlow 800: the kind word ("GATE 3 ENTRY") and the number on the gate sign. */
export const barlow = localFont({ src: './Barlow-800.woff2', weight: '800', display: 'block' });
/** Barlow Semi Condensed: filled-in values (600); the kind word when Barlow is too wide (800). */
export const barlowSemi = localFont({
  src: [
    { path: './BarlowSemiCondensed-600.woff2', weight: '600' },
    { path: './BarlowSemiCondensed-800.woff2', weight: '800' },
  ],
  display: 'block',
});
/** Barlow Condensed: labels and the heading (500, 700); values (600) and the kind word (800) when the wider cuts don't fit. */
export const barlowCondensed = localFont({
  src: [
    { path: './BarlowCondensed-500.woff2', weight: '500' },
    { path: './BarlowCondensed-600.woff2', weight: '600' },
    { path: './BarlowCondensed-700.woff2', weight: '700' },
    { path: './BarlowCondensed-800.woff2', weight: '800' },
  ],
  display: 'block',
});
/** IBM Plex Mono 600: the serial and Reg. No. (every digit one width, dotted zero). */
export const plexMono = localFont({ src: './IBMPlexMono-600.woff2', weight: '600', display: 'block' });
/** Marcellus: the RS/SB monogram letters on the Ledger. */
export const marcellus = localFont({ src: './Marcellus-400.woff2', weight: '400', display: 'block' });

/* Free Helpline Sewa passes (E-Rickshaw, Eco, Metro): see components/cards/Helpline.tsx. */
/** Mukta 800 (Devanagari and Basic Latin; Latin so its cap height measures): "केवल बुजुर्गों व विकलांगों के लिए". */
export const mukta = localFont({ src: './Mukta-800.woff2', weight: '800', display: 'block' });
