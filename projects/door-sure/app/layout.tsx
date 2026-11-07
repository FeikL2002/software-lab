import type { Metadata } from "next";
import { Manrope, Newsreader } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const sans = Manrope({ variable: "--font-sans", subsets: ["latin"] });
const serif = Newsreader({ variable: "--font-serif", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3002";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    title: "Door Sure — OHIO | Real homes. Clear proof.",
    description:
      "Ohio’s verified rental marketplace, where every listing shows who and what was checked.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Door Sure — OHIO | Rent the home. Skip the doubt.",
      description:
        "Verified Ohio rentals with clear identity, property, and place checks.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Door Sure — OHIO | Rent the home. Skip the doubt.",
      description:
        "Verified Ohio rentals with clear identity, property, and place checks.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable}`}>{children}</body>
    </html>
  );
}
