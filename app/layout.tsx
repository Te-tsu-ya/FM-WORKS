import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FM WORKS",
  description: "FM WORKS 開発版・架空データ・Sites SQL",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
