import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { ClientShellLayout } from "./client-shell-layout";
import { Toaster } from "sonner";
import { PdfDownloadInterceptor } from "@/components/pdf-download-interceptor";
import { KaiProvider } from "@/components/kai/kai-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  description: "Modern ERP admin portal",
};

// Admin portal requires auth — skip static generation for all pages.
export const dynamic = "force-dynamic";

// Inline script that runs before first paint to:
// 1. Lock the company into sessionStorage (so other tabs can't override this tab)
// 2. Apply the saved accent theme class (e.g. "theme-rose")
// 3. Set dynamic title and favicon based on company type
// Reads sessionStorage first (tab-scoped), falls back to localStorage.
// Unofficial companies default to "rose" when no accent is stored.
const COMPANY_INIT_SCRIPT = `(function(){try{
var K="ahtrading.companyId",O="00000000-0000-0000-0000-000000000001";
var c="";try{c=sessionStorage.getItem(K)||""}catch(e){}
if(!c){c=localStorage.getItem(K)||"";if(c){try{sessionStorage.setItem(K,c)}catch(e){}}}
var k=c?"admin.accentTheme."+c:"admin.accentTheme";
var a=localStorage.getItem(k)||localStorage.getItem("admin.accentTheme")||"";
var v=["cobalt","sky","emerald","teal","rose","slate"];
if(!a&&c&&c!==O){a="rose"}
if(v.indexOf(a)>=0){document.documentElement.classList.add("theme-"+a)}
if(!c){document.title="Codex Admin";return}
var u=c&&c!==O;
document.title=u?"Codex Admin - Unofficial":"Codex Admin - Official";
var s=document.createElement("link");s.rel="icon";s.type="image/svg+xml";
var col=u?"#e11d48":"#0d9488";
s.href="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="'+col+'"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18" font-family="sans-serif" font-weight="bold">A</text></svg>');
var ex=document.querySelector('link[rel="icon"]');if(ex)ex.remove();document.head.appendChild(s)
}catch(e){}})()`;


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: COMPANY_INIT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <PdfDownloadInterceptor />
          <KaiProvider>
            <ClientShellLayout>{children}</ClientShellLayout>
          </KaiProvider>
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
