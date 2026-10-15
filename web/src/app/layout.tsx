import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Providers } from "@/components/providers";
import { EARLY_SCRIPT } from "@/lib/install-early";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { default: "Kold", template: "%s · Kold" },
  description: "Kold finds genuine opportunities that match your resume and runs your cold outreach, with you approving every email.",
  applicationName: "Kold",
  manifest: `${base}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "Kold", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png" }],
    apple: [{ url: `${base}/icons/apple-touch-icon.png`, sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#05070d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="ambient" aria-hidden />
        <Providers>{children}</Providers>
        <Script id="kold-install" strategy="beforeInteractive">{EARLY_SCRIPT}</Script>
      </body>
    </html>
  );
}
