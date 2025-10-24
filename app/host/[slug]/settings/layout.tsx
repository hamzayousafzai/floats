"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { Building, Users, Bell, CircleUser } from "lucide-react";

const tabs = [
  { name: "Organization", href: "", icon: Building },
  { name: "Members", href: "/members", icon: Users },
  { name: "Notifications", href: "/notifications", icon: Bell },
  { name: "Account", href: "/account", icon: CircleUser },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useParams<{ slug: string }>();
  const basePath = `/host/${params.slug}/settings`;

  return (
    <div className="bg-gray-50 min-h-full">
      {/* FIX: Changed padding from p-4 to px-2 py-4 for better mobile view */}
      <div className="px-2 py-4 sm:p-6">
        <h1 className="text-2xl font-bold mb-4 px-2 sm:px-0">Settings</h1>
        
        <div className="tabs tabs-bordered overflow-x-auto">
          {tabs.map((tab) => {
            const fullHref = `${basePath}${tab.href}`;
            // This logic correctly handles the base path and nested routes
            const isActive = (tab.href === "" && pathname === fullHref) || (tab.href !== "" && pathname.startsWith(fullHref));
            return (
              <Link
                key={tab.name}
                href={fullHref}
                className={`tab gap-2 px-4 ${isActive ? "tab-active" : ""}`}
              >
                <tab.icon size={16} />
                {tab.name}
              </Link>
            );
          })}
        </div>

        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}