// FIX: This layout uses hooks, so it must be a client component.
"use client";

// FIX: Import the BottomNav component
import BottomNav from "@/components/nav/BottomNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col">
      {/* FIX: Adjust main content area to prevent overlap with the new nav bar */}
      <main className="flex-1 overflow-y-auto pb-20">
        {children}
      </main>

      {/* FIX: Replace the old DaisyUI dock with the BottomNav component */}
      <BottomNav />
    </div>
  );
}