"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { GoodsReceiptDraftEditor } from "../../_components/draft-editor";

function Inner({ id }: { id: string }) {
  return <GoodsReceiptDraftEditor mode="edit" receiptId={id} />;
}

export default function GoodsReceiptEditPage() {
  const params = useParams();
  const idParam = (params as Record<string, string | string[] | undefined>)?.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? (idParam[0] || "") : "";

  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner id={id} />
    </Suspense>
  );
}
