import type { Metadata } from "next";
import "./globals.css";
import { DuckProvider } from "@/lib/DuckContext";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { FilterProvider } from "@/lib/filters";

export const metadata: Metadata = {
  title: "UPI Fraud Ring & Merchant Analytics",
  description: "TransOrg AgentIQ Datathon, Track 1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
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
      </body>
    </html>
  );
}
