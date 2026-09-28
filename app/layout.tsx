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
    images: [{ url: "/brand/v2/social.png", width: 1200, height: 1200, alt: "Crime Map — True Crime карта Будапешта" }],
  },
  twitter: { card: "summary_large_image", title: "Crime Map — True Crime карта Будапешта", description: "Проверенные происшествия и громкие дела Будапешта на интерактивной карте.", images: ["/brand/v2/social.png"] },
  manifest: "/site.webmanifest?v=2",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: [
      { url: "/brand/v2/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { url: "/brand/v2/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/v2/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/v2/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    shortcut: "/brand/v2/favicon.ico",
    apple: [{ url: "/brand/v2/icon-180.png", sizes: "180x180", type: "image/png" }],
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
