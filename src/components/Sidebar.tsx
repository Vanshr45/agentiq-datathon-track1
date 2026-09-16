"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDuck } from "@/lib/DuckContext";

const NAV = [
  { href: "/", label: "Overview", icon: "▦" },
  { href: "/merchants", label: "Merchant Risk", icon: "▤" },
  { href: "/users", label: "User Risk", icon: "◉" },
  { href: "/quality", label: "Data Quality", icon: "✓" },
  { href: "/ask", label: "Ask the data", icon: "❯" },
];

export default function Sidebar() {
  const path = usePathname();
  const duck = useDuck();
  return (
    <aside className="w-60 shrink-0 border-r border-slate-200 bg-white px-5 py-8">
      <div className="text-lg font-semibold mb-6">Navigation</div>
      <nav className="space-y-1">
        {NAV.map((n) => {
          const active = path === n.href;
          return (
            <Link key={n.href} href={n.href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${active ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
              <span className="w-4 text-center text-xs text-slate-400">{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-8 text-xs text-slate-500">TransOrg AgentIQ Datathon, Track 1</div>
      <div className="mt-2 text-xs text-slate-400">
        {duck.status === "ready" ? "Data loaded in browser" : duck.status === "error" ? "Data failed to load" : duck.message + "..."}
      </div>
    </aside>
  );
}
