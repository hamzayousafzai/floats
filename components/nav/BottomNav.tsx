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
			className="fixed inset-x-0 bottom-0 z-[8000]"
			style={{ height: "var(--floats-nav-total)" }}
			aria-label="Primary"
		>
			<div className="mx-auto h-full max-w-md">
				<ul
					className="m-0 list-none flex h-full items-stretch justify-around
                     rounded-t-2xl border-t border-black/10 bg-white/95 backdrop-blur
                     supports-[backdrop-filter]:bg-white/80 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]
                     px-1 pb-[env(safe-area-inset-bottom)]"
				>
					{TABS.map(({ href, label, Icon }) => {
						const active = pathname === href || pathname.startsWith(href + "/");
						return (
							<li key={href} className="flex flex-1">
								<Link
									href={href}
									aria-current={active ? "page" : undefined}
									className="group relative flex flex-1 flex-col items-center justify-center
                             rounded-xl text-[11px] font-medium focus:outline-none
                             focus-visible:ring-2 focus-visible:ring-black/40"
								>
									{active && (
										<span
											aria-hidden
											className="absolute inset-1 rounded-xl bg-gray-100 shadow-inner"
										/>
									)}
									<Icon
										size={36}
										className={`relative mb-0.5 transition-colors ${
											active ? "text-black" : "text-gray-500 group-hover:text-gray-700"
										}`}
									/>
									<span
										className={`relative transition-colors ${
											active ? "text-black" : "text-gray-500 group-hover:text-gray-700"
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
		</nav>
	);
}