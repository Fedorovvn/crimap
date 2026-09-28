import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://crimap.online"),
  title: { default: "Crime Map — True Crime карта Будапешта", template: "%s | Crime Map" },
  description: "Проверенные происшествия и громкие дела Будапешта на интерактивной карте.",
  applicationName: "Crime Map",
  keywords: ["Crime Map", "True Crime", "Будапешт", "происшествия", "карта преступлений"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", url: "/", siteName: "Crime Map", title: "Crime Map — True Crime карта Будапешта",
    description: "Проверенные происшествия и громкие дела Будапешта на интерактивной карте.", locale: "ru_RU", alternateLocale: ["en_GB", "hu_HU"],
    images: [{ url: "/crime-map-social.png", width: 1200, height: 630, alt: "Crime Map — True Crime карта Будапешта" }],
  },
  twitter: { card: "summary_large_image", title: "Crime Map — True Crime карта Будапешта", description: "Проверенные происшествия и громкие дела Будапешта на интерактивной карте.", images: ["/crime-map-social.png"] },
  manifest: "/site.webmanifest",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    shortcut: "/favicon.svg",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
