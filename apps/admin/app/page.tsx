import { redirect } from "next/navigation";

/**
 * Root page — middleware handles the redirect, but this is a fallback.
 */
export default function HomePage() {
  redirect("/login");
}
