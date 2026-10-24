import type { Metadata } from "next";
import { Suspense } from "react";
import { CourseList } from "@/components/courses/course-list";
import { Skeleton } from "@/components/ui/skeleton";
import { listCourseSummaries } from "@/lib/services/courses";
import { getStudentRecord } from "@/lib/student/store";

export const metadata: Metadata = { title: "Course Explorer" };

export default function CoursesPage() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <h2 className="text-2xl font-semibold tracking-tight">Courses</h2>
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Courses />
      </Suspense>
    </main>
  );
}

async function Courses() {
  const record = await getStudentRecord();
  return <CourseList {...await listCourseSummaries(record)} />;
}
