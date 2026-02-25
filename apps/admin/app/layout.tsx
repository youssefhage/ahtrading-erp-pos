import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ClientShellLayout } from "./client-shell-layout";
import { ToastProvider } from "@/components/toast-provider";
import { PdfDownloadInterceptor } from "@/components/pdf-download-interceptor";

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

const ADMIN_THEME_INIT_SCRIPT = `(function(){try{
var COLOR_KEY='admin.colorTheme';
var ACCENT_KEY='admin.accentTheme';
var COMPANY_KEY='ahtrading.companyId';
var cid=(localStorage.getItem(COMPANY_KEY)||'').trim();
function scopedKey(base){return cid?base+'.'+cid:base;}
function read(base,fallback){
  var scoped=localStorage.getItem(scopedKey(base));
  if(scoped!==null){return scoped;}
  var legacy=localStorage.getItem(base);
  if(legacy!==null){return legacy;}
  return fallback;
}
var ct=read(COLOR_KEY,'light');
if(ct!=='dark'){ct='light';}
var at=read(ACCENT_KEY,'cobalt');
if(!(at==='cobalt'||at==='sky'||at==='emerald'||at==='teal'||at==='rose'||at==='slate')){at='cobalt';}
var d=document.documentElement;
if(ct==='dark'){d.classList.add('dark');}else{d.classList.remove('dark');}
var themes=['cobalt','sky','emerald','teal','rose','slate'];
for(var i=0;i<themes.length;i++){d.classList.remove('theme-'+themes[i]);}
d.classList.add('theme-'+at);
}catch(e){}})();`;

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
          <PdfDownloadInterceptor />
          <ClientShellLayout>{children}</ClientShellLayout>
        </ToastProvider>
      </body>
    </html>
  );
}
