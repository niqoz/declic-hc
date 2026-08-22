import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://declic-hc-corse.niqo839499.chatgpt.site"),
  title: "Déclic HC — Simulateur heures creuses",
  description: "Comparez le tarif Base et l’option Heures Pleines / Heures Creuses selon les usages de votre foyer.",
  applicationName: "Déclic HC",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon-512.png", sizes: "512x512", type: "image/png" }], apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Déclic HC" },
  openGraph: {
    title: "Déclic HC — Vos appareils, au bon moment.",
    description: "Simulez l’impact du tarif Heures Pleines / Heures Creuses sur votre foyer.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "Déclic HC, simulateur heures creuses" }],
    locale: "fr_FR",
    type: "website",
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#20252a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
