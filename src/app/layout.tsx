import type { Metadata } from "next";
import { NavBar } from "@/components/NavBar";
import { RefreshProvider } from "@/context/RefreshContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "NNJ Real Estate Tracker",
  description: "Listings, market trends, and deal scoring for North New Jersey.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RefreshProvider>
          <NavBar />
          <main className="mx-auto max-w-[1600px] px-6 py-6">{children}</main>
        </RefreshProvider>
      </body>
    </html>
  );
}
