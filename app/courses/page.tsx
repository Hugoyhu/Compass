import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";

export const metadata: Metadata = { title: "Course Explorer" };

export default function CoursesPage() {
  return <ComingSoon title="Course Explorer" />;
}
