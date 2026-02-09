"use client";

import { PurchaseOrderDraftEditor } from "../../_components/draft-editor";

export default function PurchaseOrderEditPage({ params }: { params: { id: string } }) {
  return <PurchaseOrderDraftEditor mode="edit" orderId={params.id} />;
}

