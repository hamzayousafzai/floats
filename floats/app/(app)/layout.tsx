// floats/app/(app)/layout.tsx
import type { ReactNode } from "react";
import BottomNav from "@/components/nav/BottomNav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-white">
      {/* ensure content isn't hidden behind the fixed nav */}
      <main className="pb-[calc(env(safe-area-inset-bottom)+64px)]">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
