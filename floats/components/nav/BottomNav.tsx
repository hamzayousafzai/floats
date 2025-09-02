"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, Search, User } from "lucide-react";

const TABS = [
  { href: "/map", label: "Map", Icon: Map },
  { href: "/explore", label: "Explore", Icon: Search },
  { href: "/profile", label: "Profile", Icon: User },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto max-w-screen-sm px-3 py-2 grid grid-cols-3 gap-1">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors
                ${active ? "text-black bg-gray-100" : "text-gray-500 hover:text-black hover:bg-gray-100"}`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[11px]">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
