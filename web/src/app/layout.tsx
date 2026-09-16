import type { Metadata } from "next";
import "./globals.css";
import { DuckProvider } from "@/lib/DuckContext";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { FilterProvider } from "@/lib/filters";

export const metadata: Metadata = {
  title: "UPI Fraud Ring & Merchant Analytics",
  description: "TransOrg AgentIQ Datathon, Track 1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script adds class="dark" before React hydrates the server markup
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-page text-fg antialiased">
        <ThemeProvider>
          <DuckProvider>
            <FilterProvider>
              <div className="flex min-h-screen">
                <Sidebar />
                <main className="flex-1 px-8 py-8 max-w-[1400px]">
                  <Header />
                  {children}
                </main>
              </div>
            </FilterProvider>
          </DuckProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
