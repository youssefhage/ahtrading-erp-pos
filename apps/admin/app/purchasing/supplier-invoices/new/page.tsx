"use client";

import { Suspense } from "react";
import { SupplierInvoiceDraftEditor } from "../_components/draft-editor";

function Inner() {
  return <SupplierInvoiceDraftEditor mode="create" />;
}

export default function SupplierInvoiceNewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
