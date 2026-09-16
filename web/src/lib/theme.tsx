"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "theme";
export const DEFAULT_THEME: Theme = "dark";

// runs inline in <head> before first paint so the html class is right before any CSS is applied - no flash
export const THEME_INIT_SCRIPT = `(function(){var t;try{t=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}if(t!=="light"&&t!=="dark")t=${JSON.stringify(DEFAULT_THEME)};document.documentElement.classList.toggle("dark",t==="dark")})()`;

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: DEFAULT_THEME, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  // the init script already set the class; the React state just mirrors it once mounted (charts read it)
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  useEffect(() => { setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light"); }, []);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try { localStorage.setItem(THEME_KEY, next); } catch {}
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
