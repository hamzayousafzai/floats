"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, BarChart3, Settings } from "lucide-react";
import { useHost } from "@/lib/contexts/HostContext";

export default function HostBottomNav() {
  const pathname = usePathname();
  const { currentOrg } = useHost();

  if (!currentOrg) return null;

  const navItems = [
    { href: `/host/${currentOrg.slug}`, icon: <LayoutGrid />, label: "Events" },
    { href: `/host/${currentOrg.slug}/analytics`, icon: <BarChart3 />, label: "Analytics" },
    { href: `/host/${currentOrg.slug}/settings`, icon: <Settings />, label: "Settings" },
  ];

  return (
    <div className="btm-nav">
      {navItems.map((item) => {
        // Check if the current path starts with the item's href.
        // Special case for the base '/host/[slug]' route.
        const isActive = item.href.length > `/host/${currentOrg.slug}`.length
          ? pathname.startsWith(item.href)
          : pathname === item.href;

        return (
          <Link key={item.href} href={item.href} className={isActive ? "active" : ""}>
            {item.icon}
            <span className="btm-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}