import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { ProgramOptionsView } from "@/components/program/program-options";
import { TypicalPathView, type CourseProgress } from "@/components/program/typical-path";
import { ProgramToggle } from "@/components/degrees/program-toggle";
import { CatalogText, NotesCard, ProgramRulesCard, RequirementNav, SubstitutionsCard } from "@/components/program/program-panels";
import { RequirementCard } from "@/components/program/requirement-card";
import { RuleTree, type RuleContext } from "@/components/program/rule-tree";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { kindLabel } from "@/lib/domain/program-kinds";
import { substitutionLayouts } from "@/lib/engine/audit";
import { isPassing, buildCompletionIndex } from "@/lib/engine/prerequisites";
import type { ProgramOptions } from "@/lib/engine/program-options";
import type { TypicalPath } from "@/lib/engine/typical-path";
import { attachSubstitutions, requirementRefs } from "@/lib/engine/describe";
import { getProgramDetail, listProgramIds, type ProgramDetail } from "@/lib/services/degrees";
import { getStudentRecord } from "@/lib/student/store";

export async function generateStaticParams() {
  return (await listProgramIds()).map((id) => ({ id }));
}

export async function generateMetadata({ params }: PageProps<"/degrees/[id]">): Promise<Metadata> {
  const detail = await getProgramDetail((await params).id);
  return { title: detail?.program.name ?? "Degree Explorer" };
}

export default function DegreePage({ params }: PageProps<"/degrees/[id]">) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <Link href="/degrees" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}>
        <ArrowLeft />
        All programs
      </Link>
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Degree params={params} />
      </Suspense>
    </main>
  );
}

async function Degree({ params }: Pick<PageProps<"/degrees/[id]">, "params">) {
  const detail = await getProgramDetail((await params).id);
  if (!detail) notFound();

  const { program } = detail;
  const refs = requirementRefs(program);
  // Course substitutions render as alternative paths where the audit applies them; the rest as notes.
  const layouts = substitutionLayouts(program);
  const { byRequirement, unattached } = attachSubstitutions(program, new Set(layouts.map((l) => l.sub.id)));
  const ctx: RuleContext = { courses: detail.courseInfo, refs: refs.full };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-3xl font-normal tracking-tight">{program.name}</h2>
          <p className="text-sm text-muted-foreground">
            {[program.degree ?? kindLabel(program.kind), program.approxCredits && `${program.approxCredits} credits`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={program.source.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Catalog page
            <ExternalLink />
          </a>
          <Suspense fallback={null}>
            <AddProgram programId={program.id} />
          </Suspense>
        </div>
      </div>

      <RequirementNav requirements={program.requirements} />

      {(detail.path || detail.options) && (
        <Suspense
          fallback={
            <>
              {detail.path && <TypicalPathView path={detail.path} />}
              {detail.options && <ProgramOptionsView options={detail.options} />}
            </>
          }
        >
          <PathsWithProgress path={detail.path} options={detail.options} />
        </Suspense>
      )}

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
            />
          ))}
          {program.sampleSequence && program.sampleSequence.length > 0 && <SampleSequence detail={detail} />}
        </section>

        <aside className="space-y-4">
          <ProgramRulesCard policies={program.policies} shortRefs={refs.short} />
          <SubstitutionsCard substitutions={unattached} />
          {(program.sbc.exemptions.length > 0 || program.sbc.fulfillment.length > 0) && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Stony Brook Curriculum</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {program.sbc.exemptions.map((e) => (
                  <p key={e.category} className="text-xs">
                    <span className="font-medium">{e.category} exempt</span>
                    <span className="text-muted-foreground"> · {e.reason}</span>
                  </p>
                ))}
                {program.sbc.fulfillment.map((f, i) => (
                  <div key={i} className="space-y-1.5">
                    <p className="text-xs font-medium">{f.category} satisfied by</p>
                    <RuleTree rule={f.rule} ctx={ctx} />
                    <CatalogText text={f.sourceText} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <NotesCard notes={program.notes} />
        </aside>
      </div>
    </>
  );
}

/** The typical path and the options, marked with the visitor's progress; reads their record, so it sits in its own Suspense boundary. */
async function PathsWithProgress({ path, options }: { path: TypicalPath | null; options: ProgramOptions | null }) {
  const record = await getStudentRecord();
  const progress: CourseProgress = {};
  if (record) {
    for (const [code, state] of buildCompletionIndex(record.attempts, { includeInProgress: true })) {
      if (state === "in-progress") progress[code] = "in-progress";
      else if (isPassing(state)) progress[code] = "done";
    }
  }
  return (
    <>
      {path && <TypicalPathView path={path} progress={progress} />}
      {options && <ProgramOptionsView options={options} progress={progress} />}
    </>
  );
}

/** Reads the visitor's record, so it renders inside its own Suspense boundary. */
async function AddProgram({ programId }: { programId: string }) {
  const record = await getStudentRecord();
  return <ProgramToggle programId={programId} added={record?.programIds.includes(programId) ?? false} />;
}

function SampleSequence({ detail }: { detail: ProgramDetail }) {
  const terms = detail.program.sampleSequence ?? [];
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Sample schedule</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {terms.map((term, i) => (
            <div key={i} className="rounded-lg border">
              <p className="flex justify-between border-b px-3 py-1.5 text-xs font-medium">
                <span>
                  Year {term.year} · {term.season}
                </span>
                <span className="text-muted-foreground tabular-nums">{term.slots.reduce((sum, s) => sum + s.credits, 0)} cr</span>
              </p>
              <ul className="divide-y text-xs">
                {term.slots.map((slot, j) => (
                  <li key={j} className="flex items-baseline gap-2 px-3 py-1">
                    {slot.kind === "course" ? (
                      <>
                        <span className="shrink-0 font-mono">{[slot.code, ...(slot.alternatives ?? [])].join(" / ")}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{detail.courseInfo[slot.code]?.title}</span>
                      </>
                    ) : (
                      <span className="min-w-0 flex-1 text-muted-foreground italic">{slot.label}</span>
                    )}
                    <span className="shrink-0 text-muted-foreground tabular-nums">{slot.credits}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
