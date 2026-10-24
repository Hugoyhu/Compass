import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";

export const metadata: Metadata = { title: "Semester Planner" };

export default function PlannerPage() {
  return (
    <ComingSoon
      title="Semester Planner"
      description="A semester-by-semester path to graduation that you can edit."
      planned={[
        "Proposed schedule for each remaining term",
        "Add, remove, and move courses with prerequisite and credit-load checks",
        "Compare alternative plans side by side",
      ]}
    />
  );
}
