import type { Metadata } from "next";
import { Suspense } from "react";
import { ScheduleBuilder } from "@/components/planner/schedule-builder";
import { Skeleton } from "@/components/ui/skeleton";
import { getNeededForTerm, getScheduleView } from "@/lib/services/schedule";
import { readSchedule } from "@/lib/student/schedule";
import { getStudentRecord } from "@/lib/student/store";

export const metadata: Metadata = { title: "Schedule Builder" };

export default function PlannerPage({ searchParams }: PageProps<"/planner">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-12">
      <Suspense fallback={<Skeleton className="h-[40rem]" />}>
        <Schedule searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Schedule({ searchParams }: Pick<PageProps<"/planner">, "searchParams">) {
  const { term } = await searchParams;
  const view = await getScheduleView(typeof term === "string" ? term : undefined);
  const selected = view.term ? await readSchedule(view.term) : [];
  const needed = await getNeededForTerm(await getStudentRecord(), view.term);
  return <ScheduleBuilder key={view.term} view={view} initialSelected={selected} needed={needed} />;
}
