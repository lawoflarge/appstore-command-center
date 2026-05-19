import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "App Store Command Center" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="mx-auto max-w-6xl px-5 py-8">{children}</div>
      </body>
    </html>
  );
}
