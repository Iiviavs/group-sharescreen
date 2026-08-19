import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { AuthProvider } from "@/lib/AuthContext";
import "./globals.css";

const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GoLive: AntiJanja",
  description: "Compartilhamento de tela de grupo em tempo real via WebRTC.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
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
        {TURNSTILE_SITE_KEY && (
          // render=explicit: lib/turnstile.ts renders its own widget
          // programmatically (see getTurnstileToken) instead of the script
          // auto-rendering anything with a "cf-turnstile" class.
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
