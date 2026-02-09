"use client";

import { Suspense } from "react";
import { GoodsReceiptDraftEditor } from "../_components/draft-editor";

function Inner() {
  return <GoodsReceiptDraftEditor mode="create" />;
}

export default function GoodsReceiptNewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-6 py-10 text-sm text-fg-muted">Loading...</div>}>
      <Inner />
    </Suspense>
  );
}

