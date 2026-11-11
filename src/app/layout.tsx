import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/client/trpc';
import { condensed, legible } from '@/fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pass Register',
  description: 'Mobile, Bike and Vehicle passes',
  // A pass: white card with the maroon band top and bottom.
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 32'><rect x='1' y='1' width='22' height='30' rx='2' fill='white' stroke='%23891001' stroke-width='2'/><rect x='1' y='1' width='22' height='9' fill='%23891001'/><rect x='1' y='26' width='22' height='5' fill='%23891001'/></svg>",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${legible.variable} ${condensed.variable}`}>
      <body className="bg-background font-sans text-[15px] text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
