import type { Metadata } from "next";
import { Suspense } from "react";
import { CourseList } from "@/components/courses/course-list";
import { Skeleton } from "@/components/ui/skeleton";
import { listCourseSummaries } from "@/lib/services/courses";
import { getStudentRecord } from "@/lib/student/store";

export const metadata: Metadata = { title: "Course Explorer" };

export default function CoursesPage() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-10 px-4 py-8 md:px-8 md:py-12">
      <h2 className="text-5xl font-bold tracking-tight md:text-6xl">Courses</h2>
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
