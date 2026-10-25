import { Suspense } from "react";
import { CourseDetailView } from "@/components/courses/course-detail-view";
import { CourseModal } from "@/components/courses/course-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { codeFromSlug } from "@/lib/domain/course-slug";

export async function generateStaticParams() {
  return [{ code: "CSE-214" }];
}

/** A course opened from the list, shown over it. */
export default function CourseModalPage({ params }: PageProps<"/courses/[code]">) {
  return (
    <CourseModal>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Course params={params} />
      </Suspense>
    </CourseModal>
  );
}

async function Course({ params }: Pick<PageProps<"/courses/[code]">, "params">) {
  return <CourseDetailView code={codeFromSlug((await params).code)} inDialog />;
}
