import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const tidFont = localFont({
  src: [
    {
      path: "./fonts/TID-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/TID-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/TID-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-tid",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Ruter Reisetid",
  description: "Interaktivt isokron-kart for Ruter",
  appleWebApp: {
    capable: true,
    title: "Ruter Reisetid",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="no">
      <body className={`${tidFont.variable} antialiased font-sans`}>
        {children}
      </body>
    </html>
  );
}
