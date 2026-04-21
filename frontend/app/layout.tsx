import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'APEX-Q Terminal // Elliott Wave Pro',
  description: 'Professional Elliott Wave & Fibonacci analysis terminal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
