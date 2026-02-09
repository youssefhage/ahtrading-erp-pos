"use client";

import { useParams } from "next/navigation";
import { PurchaseOrderDraftEditor } from "../../_components/draft-editor";

export default function PurchaseOrderEditPage() {
  const params = useParams();
  const idParam = (params as Record<string, string | string[] | undefined>)?.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? (idParam[0] || "") : "";
  return <PurchaseOrderDraftEditor mode="edit" orderId={id} />;
}
