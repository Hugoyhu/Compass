import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";

export const metadata: Metadata = { title: "Course Explorer" };

export default function CoursesPage() {
  return (
    <ComingSoon
      title="Course Explorer"
      description="Search and filter the catalog, and inspect prerequisites before you plan."
      planned={[
        "Search by code, title, or keyword",
        "Filter by subject, level, SBC, credits, and typical offering",
        "Course detail with a prerequisite tree and your eligibility",
      ]}
    />
  );
}
