import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { AuthProvider } from "@/lib/AuthContext";
import "./globals.css";

const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

const SITE_URL = "https://golive.nemtudo.me";
const SITE_NAME = "GoLive";
const TITLE = "GoLive — Transmissão de Tela em Grupo Online Grátis";
const DESCRIPTION =
  "Transmita sua tela para várias pessoas ao mesmo tempo, direto do navegador. Crie uma sala em 4 cliques sem cadastro: a forma mais fácil de fazer transmissão de tela em grupo online.";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  keywords: [
    "transmitir tela",
    "transmissão de tela online",
    "transmitir tela em grupo",
    "transmissão de tela em grupo online fácil",
    "compartilhar tela online",
    "compartilhamento de tela em grupo",
    "compartilhar tela com amigos",
    "assistir tela em grupo",
    "sala de compartilhamento de tela",
    "screen share online grátis",
    "GoLive",
    "AntiJanja"
  ],
  applicationName: SITE_NAME,
  authors: [{ name: "NemTudo", url: "https://discord.gg/nemtudo" }],
  creator: "NemTudo",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "GoLive — transmissão de tela em grupo online",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: DESCRIPTION,
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Any (navegador web)",
  inLanguage: "pt-BR",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "BRL",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col">
        <Script
          id="jsonld-webapplication"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <AuthProvider>
          <AnnouncementBanner />
          {children}
        </AuthProvider>
        {UMAMI_WEBSITE_ID && (
          <Script
            src="/api/umami/script.js"
            data-website-id={UMAMI_WEBSITE_ID}
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
