import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ClientShellLayout } from "./client-shell-layout";
import { ToastProvider } from "@/components/toast-provider";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  display: "swap",
  variable: "--font-sans"
});

const robotoNumeric = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-mono"
});

export const metadata: Metadata = {
  title: "AH Trading Admin",
  description: "Industrial-grade ERP for AH Trading"
};

const ADMIN_THEME_INIT_SCRIPT = `(function(){try{var ct=localStorage.getItem('admin.colorTheme');if(!ct){ct='light';}var at=localStorage.getItem('admin.accentTheme');if(!at){at='cobalt';}var d=document.documentElement;if(ct==='dark'){d.classList.add('dark');}else{d.classList.remove('dark');}try{var cls=Array.prototype.slice.call(d.classList);for(var i=0;i<cls.length;i++){if(String(cls[i]||'').indexOf('theme-')===0){d.classList.remove(cls[i]);}}}catch(e2){}d.classList.add('theme-'+at);var map={cobalt:['37 99 235','255 255 255','29 78 216','37 99 235','37 99 235'],sky:['14 165 233','0 0 0','3 105 161','14 165 233','14 165 233'],emerald:['16 185 129','0 0 0','4 120 87','16 185 129','16 185 129'],teal:['20 184 166','0 0 0','15 118 110','20 184 166','20 184 166'],rose:['244 63 94','255 255 255','190 18 60','244 63 94','244 63 94'],slate:['100 116 139','255 255 255','51 65 85','100 116 139','100 116 139']};var v=map[at]||map.cobalt;d.style.setProperty('--primary',v[0]);d.style.setProperty('--primary-fg',v[1]);d.style.setProperty('--primary-dim',v[2]);d.style.setProperty('--primary-glow',v[3]);d.style.setProperty('--ring',v[4]);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${roboto.variable} ${robotoNumeric.variable}`} suppressHydrationWarning>
      <head>
        <Script
          id="admin-theme-init"
          strategy="beforeInteractive"
        >{ADMIN_THEME_INIT_SCRIPT}</Script>
      </head>
      <body className="font-sans antialiased">
        <ToastProvider>
          <ClientShellLayout>{children}</ClientShellLayout>
        </ToastProvider>
      </body>
    </html>
  );
}
