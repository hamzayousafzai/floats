import type { ReactNode } from "react";
import BottomNav from "@/components/nav/BottomNav";
import AppHeader from "@/components/layouts/AppHeader";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <AppHeader />
      {/* content gets padding equal to nav height + safe-area inset so it can't be hidden */}
      <div className="pb-[calc(64px+env(safe-area-inset-bottom))]">{children}</div>
      
      {/* fixed nav on top of everything */}
      <BottomNav />
    </div>
  );
}