import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Ruter Reisetid POC",
  description: "Interaktivt isokron-kart for Ruter",
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
