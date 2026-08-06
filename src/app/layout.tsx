import type { Metadata } from "next";
import { SITE_ORIGIN } from "@/lib/routes";
import { Cal_Sans, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

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

export const metadata: Metadata = {
  // Hardcoded origin so OG/canonical tags survive a preview deployment.
  metadataBase: new URL(SITE_ORIGIN),
  title: "Open Builder Score",
  description:
    "An open Builder Score anyone can compute: enter a wallet and get an explainable score, computed in your browser from public data. Built by Talent Protocol.",
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
          {/* Flex shell so main flex-1 pushes the footer to the viewport bottom. */}
          <div className="flex min-h-dvh flex-1 flex-col">
            <Header />
            {children}
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
