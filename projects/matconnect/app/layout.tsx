import type { Metadata } from "next";
import { headers } from "next/headers";
import { Barlow_Condensed, Inter } from "next/font/google";
import "./globals.css";

const display = Barlow_Condensed({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700", "800", "900"] });
const body = Inter({ variable: "--font-body", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") || incoming.get("host") || "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "MatConnect — Free Websites for Wrestling Clubs";
  const description = "Create a free, shareable wrestling club page with programs, practice schedule, photos, and contact details.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: `${origin}/og.jpg`, width: 1200, height: 630, alt: "MatConnect — Put your club on the map." }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.jpg`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${display.variable} ${body.variable}`}>{children}</body></html>;
}
