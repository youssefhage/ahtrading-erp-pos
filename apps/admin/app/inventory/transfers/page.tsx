import { redirect } from "next/navigation";

export default function TransfersIndexPage() {
  redirect("/inventory/transfers/list");
}

