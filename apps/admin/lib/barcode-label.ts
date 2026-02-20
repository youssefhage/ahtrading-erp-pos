type BarcodeFormat = "EAN13" | "CODE128";

type JsBarcodeFn = (element: SVGElement, text: string, options?: Record<string, unknown>) => void;

export type BarcodeStickerInput = {
  barcode: string;
  sku?: string | null;
  name?: string | null;
  uom?: string | null;
};

function randomDigitString(length: number): string {
  if (length <= 0) return "";
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += String(bytes[i] % 10);
  return out;
}

function ean13CheckDigit(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error("EAN-13 base must be 12 digits.");
  let sum = 0;
  for (let i = 0; i < base12.length; i += 1) {
    const digit = Number(base12[i] || "0");
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function generateEan13Barcode(): string {
  const body = `${Date.now()}${randomDigitString(4)}`.slice(-12);
  const base12 = `2${body.slice(1)}`;
  return `${base12}${ean13CheckDigit(base12)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function barcodeFormatFor(value: string): BarcodeFormat {
  return /^\d{13}$/.test(value) ? "EAN13" : "CODE128";
}

async function barcodeSvgMarkup(value: string): Promise<string> {
  const code = String(value || "").trim();
  if (!code) throw new Error("Barcode is required.");
  const mod = (await import("jsbarcode")) as { default: JsBarcodeFn };
  const JsBarcode = mod.default;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, code, {
    format: barcodeFormatFor(code),
    lineColor: "#111",
    background: "#fff",
    width: 1.35,
    height: 46,
    margin: 0,
    displayValue: true,
    textMargin: 2,
    fontSize: 11,
  });
  return svg.outerHTML;
}

export async function printBarcodeStickerLabel(input: BarcodeStickerInput): Promise<void> {
  const barcode = String(input.barcode || "").trim();
  if (!barcode) throw new Error("Enter or generate a barcode first.");

  const popup = window.open("", "_blank", "noopener,noreferrer,width=420,height=320");
  if (!popup) throw new Error("Unable to open print window. Please allow popups for this app.");

  const sku = String(input.sku || "").trim();
  const name = String(input.name || "").trim();
  const uom = String(input.uom || "").trim();
  const heading = sku || name || "Item Barcode";
  const meta = [sku && name ? name : "", uom ? `UOM: ${uom}` : ""].filter(Boolean).join(" · ");
  try {
    const svg = await barcodeSvgMarkup(barcode);
    popup.document.open();
    popup.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(heading)}</title>
    <style>
      @page { size: 50mm 30mm; margin: 2mm; }
      html, body {
        width: 50mm;
        height: 30mm;
        margin: 0;
        padding: 0;
        background: #fff;
        color: #111;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .label {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        border: 0.2mm solid #d4d4d8;
        border-radius: 1mm;
        padding: 1.2mm;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 1mm;
      }
      .title {
        font-size: 8pt;
        line-height: 1.2;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .meta {
        font-size: 6.8pt;
        line-height: 1.2;
        color: #52525b;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .barcode {
        width: 100%;
        min-height: 14mm;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .barcode > svg {
        width: 100%;
        height: 100%;
      }
      .code {
        text-align: center;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 8pt;
        letter-spacing: 0.04em;
      }
    </style>
  </head>
  <body>
    <div class="label">
      <div>
        <div class="title">${escapeHtml(heading)}</div>
        ${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ""}
      </div>
      <div class="barcode">${svg}</div>
      <div class="code">${escapeHtml(barcode)}</div>
    </div>
    <script>
      (function () {
        var doPrint = function () {
          setTimeout(function () {
            window.print();
            setTimeout(function () { window.close(); }, 150);
          }, 80);
        };
        if (document.readyState === "complete") doPrint();
        else window.addEventListener("load", doPrint, { once: true });
      })();
    </script>
  </body>
</html>`);
    popup.document.close();
  } catch (e) {
    popup.close();
    throw e;
  }
}
