import { redirect } from "next/navigation";

export default function ItemsIndexPage() {
  redirect("/catalog/items/list");
}
