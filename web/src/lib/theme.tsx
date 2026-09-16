"use client";
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "theme";
export const DEFAULT_THEME: Theme = "dark";

// runs inline in <head> before first paint so the html class is right before any CSS is applied - no flash
export const THEME_INIT_SCRIPT = `(function(){var t;try{t=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}if(t!=="light"&&t!=="dark")t=${JSON.stringify(DEFAULT_THEME)};document.documentElement.classList.toggle("dark",t==="dark")})()`;

// the <html> class is the source of truth (the init script sets it before React runs); React just subscribes to it
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const read = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");
const readServer = (): Theme => DEFAULT_THEME;

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: DEFAULT_THEME, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, read, readServer);
  const toggle = useCallback(() => {
    const next: Theme = read() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    listeners.forEach((fn) => fn());
  }, []);
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
