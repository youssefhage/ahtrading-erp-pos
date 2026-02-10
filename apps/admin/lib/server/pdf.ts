import type { ReactElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";

export async function pdfResponse(opts: { element: ReactElement; filename: string; inline?: boolean }) {
  const buf = await renderToBuffer(opts.element);
  // Buffer isn't part of the DOM `BodyInit` type; wrap it in a Uint8Array for Response.
  const body = new Uint8Array(buf);
  const disposition = `${opts.inline ? "inline" : "attachment"}; filename="${opts.filename}"`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store"
    }
  });
}
