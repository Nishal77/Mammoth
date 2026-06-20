import { Suspense } from "react";
import { DepartmentsClient } from "./DepartmentsClient";

export default function DepartmentsPage() {
  return (
    <Suspense fallback={<div style={{ color: "var(--text-muted)", fontSize: 13, paddingTop: 48 }}>Loading...</div>}>
      <DepartmentsClient />
    </Suspense>
  );
}
