import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Breadcrumb } from "@/components/breadcrumb";
import { CommandPalette } from "@/components/command-palette";
import { HeaderNav } from "@/components/header-nav";
import { SyncButton } from "@/components/sync-button";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Anki Deck Manager",
  description: "Manage and study your Anki decks",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex min-h-dvh flex-col`}
      >
        <header className="app-header border-b border-foreground/10">
          <div className="app-row flex items-center justify-between gap-2 py-3">
            <div className="app-no-drag">
              <HeaderNav />
            </div>
            <div className="app-no-drag flex items-center gap-2">
              <SyncButton />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className="app-row pt-5">
          <Breadcrumb />
        </div>
        <main className="app-row flex flex-1 flex-col py-6">{children}</main>
        <CommandPalette />
      </body>
    </html>
  );
}
