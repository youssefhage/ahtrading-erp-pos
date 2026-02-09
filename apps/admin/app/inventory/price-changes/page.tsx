import { redirect } from "next/navigation";

export default function PriceChangesIndexPage() {
  redirect("/inventory/price-changes/list");
}

