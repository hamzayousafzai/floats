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
    <nav
      id="bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-[10000] select-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      {/* Full‑bleed bar */}
      <div className="w-full border-t border-black/10 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-[0_-2px_4px_0_rgba(0,0,0,0.05)]">
        <ul className="m-0 list-none grid grid-cols-3 w-full max-w-md mx-auto">
          {TABS.map(({ href, label, Icon }) => {
            const active =
              pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href} className="relative">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className="relative flex h-[70px] flex-col items-center justify-center gap-1 text-[11px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-2 rounded-xl bg-gray-100 shadow-inner"
                    />
                  )}
                  <Icon
                    size={24}
                    className={`relative transition-colors ${
                      active
                        ? "text-black"
                        : "text-gray-500 group-hover:text-gray-700"
                    }`}
                  />
                  <span
                    className={`relative transition-colors ${
                      active
                        ? "text-black"
                        : "text-gray-500 group-hover:text-gray-700"
                    }`}
                  >
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {/* Safe‑area spacer (visual) */}
      <div className="h-[env(safe-area-inset-bottom)] w-full" />
    </nav>
  );
}