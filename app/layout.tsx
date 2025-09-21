import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import WelcomeBanner from "@/components/UI/WelcomeBanner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Floats",
  description: "Discover local markets, pop-ups, and events near you.",
  // This helps iOS safe areas and mobile viewport
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body className={inter.className}>
        {children}
        <WelcomeBanner /> {/* Add the banner here */}
      </body>
    </html>
  );
}