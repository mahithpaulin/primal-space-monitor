import './globals.css';

export const metadata = {
  title: 'Primal Space Monitor',
  description: 'Live device and compute worker monitor for the Primal Space experiment.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#060812',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
