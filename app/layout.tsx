import './globals.css';

export const metadata = {
  title: 'Studio Bot MVP',
  description: 'AI booking assistant demo for tattoo studios'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
