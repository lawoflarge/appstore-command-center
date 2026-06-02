"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshButton } from "@/components/RefreshButton";

const items = [["/", "Glance"], ["/portfolio", "Portfolio"], ["/revenue", "Revenue"], ["/aso", "ASO"], ["/reviews", "Reviews"], ["/insights", "Insights"], ["/settings", "Settings"]];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/app");
  return pathname === href || pathname.startsWith(href + "/");
}

export function Nav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="glass mb-6 flex flex-wrap gap-1 p-2 text-sm">
      {items.map(([href, label]) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl px-3 py-2 transition-colors ${active ? "bg-[var(--accent)] font-semibold text-white shadow-sm" : "text-[var(--ink-2)] hover:bg-white/60 hover:text-[var(--ink)]"}`}
          >
            {label}
          </Link>
        );
      })}
      <span className="ml-auto flex items-center">
        <RefreshButton />
      </span>
    </nav>
  );
}
