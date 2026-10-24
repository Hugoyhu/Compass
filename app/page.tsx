import Link from "next/link";
import { Suspense } from "react";
import { CreditSources } from "@/components/dashboard/credit-sources";
import { CurrentTermCard } from "@/components/dashboard/current-term-card";
import { NextSemesterCard } from "@/components/dashboard/next-semester-card";
import { RequirementsOverview } from "@/components/dashboard/requirements-overview";
import { SbcChecklistCard } from "@/components/dashboard/sbc-checklist-card";
import { GetStarted } from "@/components/onboarding/get-started";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTerm } from "@/lib/domain/terms";
import { getStudentView } from "@/lib/services/dashboard";
import { getStudentRecord } from "@/lib/student/store";

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-12 px-4 py-8 md:px-8 md:py-12">
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  const record = await getStudentRecord();
  if (!record) return <GetStarted />;

  const { student, audit, programs, nextSemester, graduation, plan, currentCourses, gpa } = await getStudentView(record);
  const { credits } = audit;
  const percent = Math.round((credits.earned / credits.required) * 100);
  const upper = credits.upperDivision;

  return (
    <>
      <header className="grid grid-cols-12 gap-x-6 gap-y-6">
        <p className="col-span-12 text-[7rem] leading-[0.8] font-bold tracking-[-0.06em] tabular-nums md:col-span-5 md:text-[11rem]">
          {percent}
          <span className="text-primary">%</span>
        </p>
        <div className="col-span-12 space-y-1 md:col-span-7 md:pt-1">
          <h2 className="text-4xl font-bold tracking-tight md:text-5xl">{student.name || "Your degree"}</h2>
          <p className="text-xl">{programs.length > 0 ? programs.map((p) => p.program.name).join(", ") : <Link href="/degrees" className="underline decoration-primary decoration-2 underline-offset-4">Add a program</Link>}</p>
          <p className="text-xl text-muted-foreground">
            {credits.standing} · {formatTerm(student.currentTerm)}
          </p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y-2 border-foreground py-5 md:grid-cols-4">
        <Stat label="Credits" value={credits.earned} of={credits.required} inProgress={credits.inProgress} />
        <Stat label="Upper division" value={upper.earned} of={upper.required} inProgress={upper.inProgress} />
        <Stat label="GPA" value={gpa.credits > 0 ? gpa.value.toFixed(2) : "—"} />
        <Stat
          label={plan?.graduation ? "Graduation" : "Estimated graduation"}
          value={formatTerm(plan?.graduation ?? graduation.term)}
        />
      </dl>

      <CreditSources credits={credits} />

      {programs.length > 0 && (
        <RequirementsOverview
          programs={programs.map((p) => ({ programId: p.program.id, name: p.program.name, results: p.requirements }))}
        />
      )}

      <div className="grid gap-x-6 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <CurrentTermCard term={student.currentTerm} courses={currentCourses} />
        </div>
        <div className="lg:col-span-4">
          <NextSemesterCard schedule={nextSemester} />
        </div>
        <div className="lg:col-span-4">
          <SbcChecklistCard audit={audit.sbc} />
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, of, inProgress = 0 }: { label: string; value: React.ReactNode; of?: number; inProgress?: number }) {
  return (
    <div className="space-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-bold tracking-tight tabular-nums">
        {value}
        {of !== undefined && <span className="font-normal text-muted-foreground">/{of}</span>}
        {inProgress > 0 && <span className="ml-2 text-base font-medium text-primary">+{inProgress}</span>}
      </dd>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-12" aria-busy="true" aria-label="Loading your dashboard">
      <div className="grid grid-cols-12 gap-6">
        <Skeleton className="col-span-12 h-36 md:col-span-5" />
        <div className="col-span-12 space-y-3 md:col-span-7">
          <Skeleton className="h-12 w-80 max-w-full" />
          <Skeleton className="h-6 w-64 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-24" />
      <Skeleton className="h-80" />
    </div>
  );
}
