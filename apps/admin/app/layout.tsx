import type { Metadata } from "next";
import "@fontsource-variable/space-grotesk/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
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
