// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import BottomNav from "@/components/nav/BottomNav";

export const metadata: Metadata = { title: "Floats", description: "Vendor discovery" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900">
        <div className="min-h-screen pb-[72px]">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
