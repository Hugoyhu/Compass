import type { Metadata } from "next";
import { Suspense } from "react";
import { DegreeList } from "@/components/degrees/degree-list";
import { Skeleton } from "@/components/ui/skeleton";
import { listProgramSummaries } from "@/lib/services/degrees";
import { getStudentRecord } from "@/lib/student/store";

export const metadata: Metadata = { title: "Degree Explorer" };

export default function DegreesPage() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-10 px-4 py-8 md:px-8 md:py-12">
      <h2 className="text-5xl font-bold tracking-tight md:text-6xl">Programs</h2>
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Programs />
      </Suspense>
    </main>
  );
}

async function Programs() {
  const [programs, record] = await Promise.all([listProgramSummaries(), getStudentRecord()]);
  return <DegreeList programs={programs} mine={record?.programIds ?? []} />;
}
