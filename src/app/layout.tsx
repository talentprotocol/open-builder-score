import type { Metadata } from "next";
import { SITE_ORIGIN } from "@/lib/routes";
import { Cal_Sans, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { SiteChrome } from "@/components/site-chrome";

const calSans = Cal_Sans({
  variable: "--font-cal-sans",
  weight: "400",
  subsets: ["latin"],
  adjustFontFallback: false,
  display: "swap",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION =
  "An open Builder Score anyone can compute: enter a wallet and get an explainable score, computed in your browser from public data. Built by Talent Protocol."

export const metadata: Metadata = {
  // Hardcoded origin so OG/canonical tags survive a preview deployment.
  metadataBase: new URL(SITE_ORIGIN),
  title: "Builder Score",
  description: DESCRIPTION,
  // The image itself comes from app/opengraph-image.tsx, which Next resolves
  // into og:image and twitter:image for every route that doesn't set its own.
  openGraph: {
    type: "website",
    siteName: "Talent Protocol",
    url: SITE_ORIGIN,
    title: "Builder Score",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Builder Score",
    description: DESCRIPTION,
  },
  other: {
    // base.dev ownership proof — ties this domain to our registered Base app.
    "base:app_id": "69395f4ae6be54f5ed71d501",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${calSans.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col blueprint-grid">
        <Providers>
          {/* SiteChrome decides Header/Footer vs. the bare opt-out shell;
              see its comment for why that has to happen per-route here. */}
          <SiteChrome>{children}</SiteChrome>
        </Providers>
      </body>
    </html>
  );
}
