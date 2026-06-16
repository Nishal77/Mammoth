import { redirect } from "next/navigation";

// Root → redirect to dashboard. Middleware handles auth gate.
export default function RootPage() {
  redirect("/dashboard");
}
