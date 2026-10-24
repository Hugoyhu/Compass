import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ExternalLink, Info, Plus } from "lucide-react";
import { StatusIcon } from "@/components/audit/status-badge";
import { ProgramToggle } from "@/components/degrees/program-toggle";
import { GetStarted } from "@/components/onboarding/get-started";
import { NotesCard, ProgramRulesCard, RequirementNav, SubstitutionsCard } from "@/components/program/program-panels";
import { RequirementCard } from "@/components/program/requirement-card";
import type { RuleContext } from "@/components/program/rule-tree";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { groupSbcResults, substitutionLayouts, type SbcResult } from "@/lib/engine/audit";
import { attachSubstitutions, requirementRefs, STATUS_LABELS } from "@/lib/engine/describe";
import { getProgressView } from "@/lib/services/progress";
import { getStudentRecord } from "@/lib/student/store";

export const metadata: Metadata = { title: "Degree Progress" };

export default function ProgressPage({ searchParams }: PageProps<"/progress">) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Progress searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** The Degree Explorer's view of one of the student's programs, with their status on top. */
async function Progress({ searchParams }: Pick<PageProps<"/progress">, "searchParams">) {
  const record = await getStudentRecord();
  if (!record) return <GetStarted />;

  const { program: requested } = await searchParams;
  const progress = await getProgressView(record, typeof requested === "string" ? requested : undefined);
  const { view, selected } = progress;

  if (!selected) {
    return (
      <Alert>
        <Info />
        <AlertTitle>No programs added</AlertTitle>
        <AlertAction>
          <Link href="/degrees" className={buttonVariants({ size: "sm" })}>
            Browse programs
          </Link>
        </AlertAction>
      </Alert>
    );
  }

  const { program } = selected;
  const refs = requirementRefs(program);
  const layouts = substitutionLayouts(program);
  const { byRequirement, unattached } = attachSubstitutions(program, new Set(layouts.map((l) => l.sub.id)));
  const ctx: RuleContext = { courses: progress.courseInfo, refs: refs.full, status: progress.statuses, choices: record.choices ?? {} };
  const results = new Map(selected.requirements.map((r) => [r.requirement.id, r]));

  return (
    <>
      <nav aria-label="Your programs" className="flex flex-wrap items-center gap-1 border-b">
        {view.programs.map((p) => {
          const active = p === selected;
          return (
            <Link
              key={p.program.id}
              href={`/progress?program=${p.program.id}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {p.program.name}
              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                {p.satisfied}/{p.total}
              </span>
            </Link>
          );
        })}
        <Link href="/degrees" className="ml-1 inline-flex items-center gap-1 px-2 py-2 text-sm text-muted-foreground hover:text-foreground">
          <Plus className="size-3.5" aria-hidden />
          Add
        </Link>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">{program.name}</h2>
          <p className="text-sm text-muted-foreground">
            {selected.satisfied} of {selected.total} requirements done
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/degrees/${program.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            View in Degree Explorer
          </Link>
          <a href={program.source.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Catalog page
            <ExternalLink />
          </a>
          <ProgramToggle programId={program.id} added />
        </div>
      </div>

      <RequirementNav
        requirements={program.requirements}
        statuses={Object.fromEntries(selected.requirements.map((r) => [r.requirement.id, r.status]))}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2" aria-label="Requirements">
          {program.requirements.map((r) => (
            <RequirementCard
              key={r.id}
              requirement={r}
              ctx={ctx}
              layouts={layouts}
              substitutions={byRequirement.get(r.id) ?? []}
              refs={refs.full}
              result={results.get(r.id)}
              activeSubstitutions={selected.activeSubstitutions}
            />
          ))}
        </section>

        <aside className="space-y-4">
          <ProgramRulesCard policies={program.policies} shortRefs={refs.short} results={selected.policies} />
          <SubstitutionsCard substitutions={unattached} />
          <Card size="sm">
            <CardHeader>
              <CardTitle>Stony Brook Curriculum</CardTitle>
              <CardDescription>
                {view.audit.sbc.satisfied} of {view.audit.sbc.total} done
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SbcChecklist results={view.audit.sbc.results} />
            </CardContent>
          </Card>
          <NotesCard notes={program.notes} />
        </aside>
      </div>
    </>
  );
}

function SbcChecklist({ results }: { results: SbcResult[] }) {
  const { required, threeOf } = groupSbcResults(results);
  return (
    <>
      <SbcList results={required} />
      {threeOf.length > 0 && (
        <>
          <p className="mt-3 mb-1.5 text-xs font-medium text-muted-foreground">Three of:</p>
          <SbcList results={threeOf} />
        </>
      )}
    </>
  );
}

function SbcList({ results }: { results: SbcResult[] }) {
  return (
    <ul className="space-y-1.5">
      {results.map((s) => (
        <li key={s.category.code} className="flex items-start gap-2 text-xs">
          <StatusIcon status={s.status} className="mt-px size-3.5" />
          <span className="w-11 shrink-0 font-medium">{s.category.code}</span>
          <span className="min-w-0 flex-1 text-muted-foreground">
            {STATUS_LABELS[s.status]}
            {s.appliedCode ? ` · ${s.appliedCode}` : ""}
            {s.exemptReason ? ` · ${s.exemptReason}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
