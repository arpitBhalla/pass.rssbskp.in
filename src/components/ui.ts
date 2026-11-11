/** Shared Tailwind class strings, so buttons and boxes look the same everywhere. */
const base =
  'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[3px] border px-3 text-[14px] font-semibold transition-colors disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
export const btn = `${base} border-input bg-background text-foreground enabled:hover:border-foreground/35 enabled:hover:bg-muted disabled:opacity-45`;
export const btnPrimary = `${base} border-primary bg-primary text-primary-foreground enabled:hover:border-primary-hover enabled:hover:bg-primary-hover disabled:border-input disabled:bg-muted disabled:text-muted-foreground`;
export const btnDanger = `${base} border-destructive/40 bg-background text-destructive hover:bg-red-50 disabled:opacity-45`;
export const input =
  'h-8 w-full rounded-[3px] border border-input bg-background px-2.5 text-[15px] outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:bg-muted';
export const label = 'flex flex-col gap-1 text-[13.5px] font-semibold text-foreground/75';
export const card = 'rounded-[3px] border border-border bg-background';
/** Heading of a group in a side panel or form. */
export const heading = 'font-condensed text-[17px] font-bold text-foreground';
