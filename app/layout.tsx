import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import WelcomeBanner from "@/components/UI/WelcomeBanner";
import { HostProvider } from "@/lib/contexts/HostContext"; // Import HostProvider

const inter = Inter({ subsets: ["latin"] });

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffffff",
};

export const metadata: Metadata = {
  title: "Floats",
  description: "Discover local markets, pop-ups, and events near you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="floats">
      <body className={inter.className}>
        <HostProvider> {/* Wrap everything with the provider */}
          {children}
          <WelcomeBanner />
        </HostProvider>
      </body>
    </html>
  );
}