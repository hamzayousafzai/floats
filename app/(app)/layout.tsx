import Link from "next/link";
import { Map, Compass, User } from "lucide-react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col">
      {/* Page content will fill the available space */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>

      {/* DaisyUI Dock for main navigation */}
      <div className="dock dock-bottom dock-center z-50 mb-4 w-full max-w-screen-sm mx-auto rounded-box bg-base-100 shadow-lg pb-[env(safe-area-inset-bottom)]">
        <Link href="/map" className="dock-item">
          <span className="text-xl"><Map /></span>
          <span className="dock-label">Map</span>
        </Link>
        <Link href="/explore" className="dock-item">
          <span className="text-xl"><Compass /></span>
          <span className="dock-label">Explore</span>
        </Link>
        <Link href="/profile" className="dock-item">
          <span className="text-xl"><User /></span>
          <span className="dock-label">Profile</span>
        </Link>
      </div>
    </div>
  );
}