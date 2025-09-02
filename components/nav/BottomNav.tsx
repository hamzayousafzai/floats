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
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* list-none prevents browser bullets when Tailwind is live */}
      <ul className="mx-auto grid max-w-md grid-cols-3 list-none">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex flex-col items-center py-2 text-xs ${active ? "text-black" : "text-gray-500"}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={22} />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
