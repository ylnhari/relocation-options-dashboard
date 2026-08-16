import type { Metadata, Viewport } from "next";
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

const title = "Wayfinder · Relocation Decision Studio";
const description =
  "An open-source, local-first studio for auditable relocation, job-offer, and household cash-flow comparisons.";

export function publicOrigin(value = process.env.WAYFINDER_PUBLIC_ORIGIN): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const origin = publicOrigin();
  const imageUrl = origin ? `${origin}/og.png` : null;

  return {
    title,
    description,
    openGraph: {
      type: "website",
      title,
      description,
      ...(imageUrl ? { images: [{ url: imageUrl, width: 1792, height: 1024, alt: "Wayfinder relocation comparison pathways" }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#07111d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
