import { redirect } from "next/navigation";

export default function PurchaseOrdersIndexPage() {
  redirect("/purchasing/purchase-orders/list");
}

