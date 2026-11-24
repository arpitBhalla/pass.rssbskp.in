/** Small line icons, in the text colour. */
const Svg = ({ size = 14, children }: { size?: number; children: React.ReactNode }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" className="shrink-0">
    {children}
  </svg>
);

/** Printed. */
export const PrinterIcon = ({ size }: { size?: number }) => (
  <Svg size={size}><path d="M4.5 6V2h7v4" /><rect x="1.5" y="6" width="13" height="5.5" rx="1" /><path d="M4.5 9.5h7V14h-7z" /></Svg>
);

/** Given (handed over). */
export const GivenIcon = ({ size }: { size?: number }) => (
  <Svg size={size}><circle cx="8" cy="8" r="6.3" /><path d="m5.2 8.3 2 2 3.8-4.3" /></Svg>
);

/** A packet. */
export const PacketIcon = ({ size }: { size?: number }) => (
  <Svg size={size}><path d="M2 4.8 8 2l6 2.8v6.4L8 14l-6-2.8z" /><path d="m2 4.8 6 2.8 6-2.8M8 7.6V14" /></Svg>
);
