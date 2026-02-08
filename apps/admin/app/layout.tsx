import type { Metadata } from "next";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto-mono/400.css";
import "@fontsource/roboto-mono/500.css";
import "@fontsource/roboto-mono/700.css";
import "./globals.css";
import { ClientShellLayout } from "./client-shell-layout";

export const metadata: Metadata = {
  title: "AH Trading Admin",
  description: "Admin ERP for AH Trading (Lebanon)"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <ClientShellLayout>{children}</ClientShellLayout>
      </body>
    </html>
  );
}
