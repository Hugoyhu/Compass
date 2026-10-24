import type { Metadata } from "next";
import { Suspense } from "react";
import { GetStarted } from "@/components/onboarding/get-started";
import { PlanEditor } from "@/components/planner/plan-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlanView } from "@/lib/services/plan";
import { getStudentRecord } from "@/lib/student/store";

export const metadata: Metadata = { title: "Semester Planner" };

export default function PlannerPage() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Planner />
      </Suspense>
    </main>
  );
}

async function Planner() {
  const record = await getStudentRecord();
  if (!record) return <GetStarted />;
  return <PlanEditor view={await getPlanView(record)} />;
}
