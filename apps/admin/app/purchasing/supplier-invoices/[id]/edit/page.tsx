"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { SupplierInvoiceDraftEditor } from "../../_components/draft-editor";

function Inner() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  return <SupplierInvoiceDraftEditor mode="edit" invoiceId={id} />;
}

export default function SupplierInvoiceEditPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
