import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "goodfind — Garage Sales Near You",
  description: "Discover nearby garage sales or list your own for just $20.",
  openGraph: {
    title: "goodfind — Garage Sales Near You",
    description: "Good stuff is closer than you think. Discover nearby garage sales or list yours for $20.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "goodfind — nearby garage sales" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "goodfind — Garage Sales Near You",
    description: "Discover nearby garage sales or list yours for $20.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
