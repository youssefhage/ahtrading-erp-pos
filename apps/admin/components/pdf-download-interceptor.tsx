"use client";

import { useEffect } from "react";

function parseFilename(contentDisposition: string | null): string {
  const raw = String(contentDisposition || "").trim();
  if (!raw) return "";

  const star = raw.match(/filename\*\s*=\s*([^;]+)/i);
  if (star?.[1]) {
    const value = star[1].trim().replace(/^UTF-8''/i, "");
    try {
      return decodeURIComponent(value).replace(/^"|"$/g, "");
    } catch {
      return value.replace(/^"|"$/g, "");
    }
  }

  const plain = raw.match(/filename\s*=\s*([^;]+)/i);
  if (!plain?.[1]) return "";
  return plain[1].trim().replace(/^"|"$/g, "");
}

function defaultPdfName(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const id = parts[parts.length - 2] || "document";
    return `${id}.pdf`;
  }
  return "document.pdf";
}

export function PdfDownloadInterceptor() {
  useEffect(() => {
    async function downloadFromHref(href: string) {
      const res = await fetch(href, { method: "GET", credentials: "include" });
      if (!res.ok) throw new Error(`PDF download failed (${res.status})`);
      const blob = await res.blob();
      if (!blob.size) throw new Error("PDF download failed (empty file)");

      const filename = parseFilename(res.headers.get("content-disposition")) || defaultPdfName(new URL(href).pathname);
      const objectUrl = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        a.rel = "noopener noreferrer";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.dataset.noPdfIntercept === "1") return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (!url.pathname.startsWith("/exports/")) return;
      if (!url.pathname.endsWith("/pdf")) return;
      if (url.searchParams.get("inline") === "1") return;

      e.preventDefault();
      void downloadFromHref(url.toString()).catch(() => {
        window.location.href = url.toString();
      });
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
