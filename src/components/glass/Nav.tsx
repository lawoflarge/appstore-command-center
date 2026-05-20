import Link from "next/link";
const items = [["/", "Glance"], ["/portfolio", "Portfolio"], ["/aso", "ASO"], ["/reviews", "Reviews"], ["/insights", "Insights"], ["/settings", "Settings"]];
export function Nav() {
  return (
    <nav className="glass mb-6 flex gap-1 p-2 text-sm">
      {items.map(([href, label]) => (
        <Link key={href} href={href} className="rounded-xl px-3 py-2 hover:bg-white/50">{label}</Link>
      ))}
    </nav>
  );
}
