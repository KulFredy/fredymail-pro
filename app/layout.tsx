import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FredyMail Pro",
  description: "Fast email search powered by Meilisearch",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className="dark">
      <body>{children}</body>
    </html>
  );
}
