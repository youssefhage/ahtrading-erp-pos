"use client";

import { Suspense } from "react";
import { SalesInvoiceDraftEditor } from "../_components/draft-editor";

function Inner() {
  return <SalesInvoiceDraftEditor mode="create" />;
}

export default function SalesInvoiceNewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
