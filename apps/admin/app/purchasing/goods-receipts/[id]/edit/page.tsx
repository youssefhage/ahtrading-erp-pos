"use client";

import { Suspense } from "react";
import { GoodsReceiptDraftEditor } from "../../_components/draft-editor";

function Inner({ id }: { id: string }) {
  return <GoodsReceiptDraftEditor mode="edit" receiptId={id} />;
}

export default function GoodsReceiptEditPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner id={params.id} />
    </Suspense>
  );
}

