import type {Metadata} from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Linguistic SEO Coach',
  description:
    'Leadership-grade fluency coaching for agency managers with transcript and Drive analysis.',
};

export default function RootLayout({
  children,
}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
