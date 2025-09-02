// floats/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Floats",
  description: "Vendor discovery",
  // This helps iOS safe areas and mobile viewport
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
