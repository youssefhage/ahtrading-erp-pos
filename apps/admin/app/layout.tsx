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
  title: "Codex Admin",
  description: "Modern ERP admin portal",
};

// Admin portal requires auth — skip static generation for all pages.
export const dynamic = "force-dynamic";

// Inline script that runs before first paint to apply the saved accent theme
// class (e.g. "theme-cobalt") so the user never sees a flash of the wrong color.
const ACCENT_INIT_SCRIPT = `(function(){try{var c=localStorage.getItem("ahtrading.companyId")||"";var k=c?"admin.accentTheme."+c:"admin.accentTheme";var a=localStorage.getItem(k)||localStorage.getItem("admin.accentTheme")||"default";var v=["cobalt","sky","emerald","teal","rose","slate"];if(v.indexOf(a)>=0){document.documentElement.classList.add("theme-"+a)}}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
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
