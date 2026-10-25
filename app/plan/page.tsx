import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { GetStarted } from "@/components/onboarding/get-started";
import { PlanEditor } from "@/components/plan/plan-editor";
import { RoadmapView } from "@/components/plan/roadmap";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlanView, getRoadmap } from "@/lib/services/plan";
import { getStudentRecord } from "@/lib/student/store";

export const metadata: Metadata = { title: "Semester Planner" };

const TABS = [
  { view: "semesters", title: "Semesters", href: "/plan" },
  { view: "roadmap", title: "Road to graduation", href: "/plan?view=roadmap" },
] as const;

export default function PlanPage({ searchParams }: PageProps<"/plan">) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8 md:px-8 md:py-12">
      <h2 className="text-5xl font-bold tracking-tight md:text-6xl">Semester Planner</h2>
      <Suspense fallback={<Skeleton className="h-[40rem]" />}>
        <Plan searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Plan({ searchParams }: Pick<PageProps<"/plan">, "searchParams">) {
  const record = await getStudentRecord();
  if (!record) return <GetStarted />;
  const active = (await searchParams).view === "roadmap" ? "roadmap" : "semesters";

  return (
    <>
      <nav aria-label="Semester Planner" className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.view}
            href={tab.href}
            aria-current={tab.view === active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab.view === active ? "border-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {tab.title}
          </Link>
        ))}
      </nav>
      {active === "roadmap" ? <RoadmapView roadmap={await getRoadmap(record)} /> : <PlanEditor view={await getPlanView(record)} />}
    </>
  );
}
