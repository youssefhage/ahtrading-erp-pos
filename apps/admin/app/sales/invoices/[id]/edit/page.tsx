"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { SalesInvoiceDraftEditor } from "../../_components/draft-editor";

function Inner() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  return <SalesInvoiceDraftEditor mode="edit" invoiceId={id} />;
}

export default function SalesInvoiceEditPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}
