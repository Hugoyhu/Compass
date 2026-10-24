import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";

export const metadata: Metadata = { title: "Semester Planner" };

export default function PlannerPage() {
  return <ComingSoon title="Semester Planner" />;
}
