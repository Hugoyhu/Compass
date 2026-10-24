import Link from "next/link";
import { Suspense } from "react";
import { CalendarCheck, FlaskConical, GraduationCap, Layers, ListChecks } from "lucide-react";
import { ProgressMeter } from "@/components/audit/progress-meter";
import { CurrentTermCard } from "@/components/dashboard/current-term-card";
import { DegreeProgressCard } from "@/components/dashboard/degree-progress-card";
import { NextSemesterCard } from "@/components/dashboard/next-semester-card";
import { OutstandingRequirementsCard } from "@/components/dashboard/outstanding-requirements-card";
import { SbcChecklistCard } from "@/components/dashboard/sbc-checklist-card";
import { StatTile } from "@/components/dashboard/stat-tile";
import { GetStarted } from "@/components/onboarding/get-started";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTerm } from "@/lib/domain/terms";
import { progressFractions } from "@/lib/engine/describe";
import { getStudentView } from "@/lib/services/dashboard";
import { getStudentRecord } from "@/lib/student/store";

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  const record = await getStudentRecord();
  if (!record) return <GetStarted />;

  const { source, student, audit, major, proposal, graduation, currentCourses } = await getStudentView(record);
  const firstName = student.name.split(" ")[0];
  const outstanding = major?.requirements.filter((r) => r.status !== "satisfied") ?? [];
  const finishing = major?.requirements.filter((r) => r.status === "in-progress").length ?? 0;
  const upper = audit.credits.upperDivision;

  return (
    <>
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{firstName ? `Welcome back, ${firstName}` : "Your degree"}</h2>
        <p className="text-sm text-muted-foreground">
          {major ? `${major.program.name} · ${major.program.source.catalog} · ` : ""}
          {audit.credits.standing} standing · Currently {formatTerm(student.currentTerm)}
        </p>
      </div>

      {!major && (
        <Alert>
          <GraduationCap />
          <AlertTitle>Choose your major</AlertTitle>
          <AlertDescription>Pick your major to see requirement progress and a next-semester plan.</AlertDescription>
          <AlertAction>
            <Link href="/record" className={buttonVariants({ size: "sm" })}>
              Choose major
            </Link>
          </AlertAction>
        </Alert>
      )}

      {source.includesDemoData && (
        <Alert className="border-status-warning/40 bg-status-warning/5">
          <FlaskConical />
          <AlertTitle>Preview data</AlertTitle>
          <AlertDescription>
            {source.disclaimer} Always confirm requirements with the official Undergraduate Catalog and your advisor.
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 lg:grid-cols-3" aria-label="Summary">
        <div className="lg:col-span-2">
          <DegreeProgressCard credits={audit.credits} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          {major && (
            <StatTile
              icon={ListChecks}
              label="Major requirements satisfied"
              value={
                <>
                  {major.satisfied}
                  <span className="text-base font-normal text-muted-foreground"> / {major.total}</span>
                </>
              }
              detail={`${finishing} more complete when current courses finish`}
            >
              <ProgressMeter completed={major.satisfied / major.total} label="Major requirements satisfied" />
            </StatTile>
          )}
          <StatTile
            icon={Layers}
            label="Upper-division credits"
            value={
              <>
                {upper.earned}
                <span className="text-base font-normal text-muted-foreground"> / {upper.required}</span>
              </>
            }
            detail={`${upper.inProgress} more in progress`}
          >
            <ProgressMeter
              {...progressFractions({ completed: upper.earned, inProgress: upper.inProgress, required: upper.required })}
              label="Upper-division credits"
            />
          </StatTile>
          <StatTile
            icon={CalendarCheck}
            label="Estimated graduation"
            value={formatTerm(graduation.term)}
            detail={`${graduation.semestersRemaining} semesters after this one at ~15 credits each. Rough estimate.`}
          />
        </div>
      </section>

      {major && (
        <section className="grid gap-4 lg:grid-cols-5" aria-label="Requirements and plan">
          <div className="lg:col-span-3">
            <OutstandingRequirementsCard results={outstanding} programName={major.program.name} />
          </div>
          <div className="lg:col-span-2">
            <NextSemesterCard proposal={proposal} />
          </div>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-5" aria-label="Current term and SBC">
        <div className="lg:col-span-2">
          <CurrentTermCard term={student.currentTerm} courses={currentCourses} />
        </div>
        <div className="lg:col-span-3">
          <SbcChecklistCard audit={audit.sbc} />
        </div>
      </section>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading your dashboard">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-56 lg:col-span-2" />
        <Skeleton className="h-56" />
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-80 lg:col-span-3" />
        <Skeleton className="h-80 lg:col-span-2" />
      </div>
    </div>
  );
}
