"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDuck } from "@/lib/DuckContext";
import { useTheme } from "@/lib/theme";

const NAV = [
  { href: "/", label: "Overview", icon: "▦" },
  { href: "/merchants", label: "Merchant Risk", icon: "▤" },
  { href: "/users", label: "User Risk", icon: "◉" },
  { href: "/quality", label: "Data Quality", icon: "✓" },
  { href: "/ask", label: "Ask the data", icon: "❯" },
];

// both icons are rendered and CSS picks one, so the button is correct on first paint even before React mounts
function ThemeToggle() {
  const { toggle } = useTheme();
  return (
    <button type="button" onClick={toggle} aria-label="Toggle light or dark mode"
      className="mt-4 flex w-full items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-muted hover:bg-surface-2">
      <svg className="h-4 w-4 dark:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg className="hidden h-4 w-4 dark:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
      <span className="dark:hidden">Light mode</span>
      <span className="hidden dark:inline">Dark mode</span>
    </button>
  );
}

export default function Sidebar() {
  const path = usePathname();
  const duck = useDuck();
  return (
    <aside className="w-60 shrink-0 border-r border-line bg-surface px-5 py-8">
      <div className="text-lg font-semibold mb-6">Navigation</div>
      <nav className="space-y-1">
        {NAV.map((n) => {
          const active = path === n.href;
          return (
            <Link key={n.href} href={n.href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${active ? "bg-surface-2 font-semibold text-fg" : "text-muted hover:bg-surface-2"}`}>
              <span className="w-4 text-center text-xs text-faint">{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <ThemeToggle />
      <div className="mt-8 text-xs text-muted">TransOrg AgentIQ Datathon, Track 1</div>
      <div className="mt-2 text-xs text-muted">
        {duck.status === "ready" ? "Data loaded in browser" : duck.status === "error" ? "Data failed to load" : duck.message + "..."}
      </div>
    </aside>
  );
}
