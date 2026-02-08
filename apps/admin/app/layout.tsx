import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import Script from "next/script";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";
import { ClientShellLayout } from "./client-shell-layout";

const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans"
});

export const metadata: Metadata = {
  title: "AH Trading Admin",
  description: "Industrial-grade ERP for AH Trading"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={schibsted.variable} suppressHydrationWarning>
      <head>
        <Script
          id="admin-theme-init"
          strategy="beforeInteractive"
        >{`(function(){try{var t=localStorage.getItem('admin.colorTheme');if(!t){t='light';}var d=document.documentElement;if(t==='dark'){d.classList.add('dark');}else{d.classList.remove('dark');}}catch(e){}})();`}</Script>
      </head>
      <body className="font-sans antialiased">
        <ClientShellLayout>{children}</ClientShellLayout>
      </body>
    </html>
  );
}
