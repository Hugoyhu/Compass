import type { Metadata } from "next";
import { Suspense } from "react";
import { DegreeList } from "@/components/degrees/degree-list";
import { Skeleton } from "@/components/ui/skeleton";
import { listProgramSummaries } from "@/lib/services/degrees";
import { getStudentRecord } from "@/lib/student/store";

export const metadata: Metadata = { title: "Degree Explorer" };

export default function DegreesPage() {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
      <h2 className="text-2xl font-semibold tracking-tight">Majors and minors</h2>
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
