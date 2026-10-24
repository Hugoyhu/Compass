import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CircleCheck, CircleDashed, CircleX, Clock, ExternalLink, Info, type LucideIcon } from "lucide-react";
import { StatusIcon } from "@/components/audit/status-badge";
import { GetStarted } from "@/components/onboarding/get-started";
import { RequirementCard } from "@/components/progress/requirement-card";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PolicyStatus } from "@/lib/engine/audit";
import { NOTE_TOPICS, POLICY_STATUS_LABELS, POLICY_TITLES, requirementHeading, STATUS_LABELS } from "@/lib/engine/describe";
import { getStudentView } from "@/lib/services/dashboard";
import { getStudentRecord } from "@/lib/student/store";

export const metadata: Metadata = { title: "Degree Progress" };

const POLICY_ICONS: Record<PolicyStatus, { icon: LucideIcon; className: string }> = {
  satisfied: { icon: CircleCheck, className: "text-status-good" },
  "in-progress": { icon: Clock, className: "text-[#a86f00]" },
  "not-met": { icon: CircleX, className: "text-status-critical" },
  pending: { icon: CircleDashed, className: "text-muted-foreground" },
  info: { icon: Info, className: "text-muted-foreground" },
};

export default function ProgressPage() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Progress />
      </Suspense>
    </main>
  );
}

async function Progress() {
  const record = await getStudentRecord();
  if (!record) return <GetStarted />;

  const { audit, major, labels, student } = await getStudentView(record);
  const attempts = new Map(student.attempts.map((a) => [a.code, a]));

  if (!major) {
    return (
      <Alert>
        <Info />
        <AlertTitle>Choose your major to see a full audit</AlertTitle>
        <AlertDescription>Degree progress compares your courses with your major&apos;s requirements.</AlertDescription>
        <AlertAction>
          <Link href="/record" className={buttonVariants({ size: "sm" })}>
            Choose major
          </Link>
        </AlertAction>
      </Alert>
    );
  }

  const { program } = major;
  const substitutions = program.substitutions;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">{program.name}</h2>
          <p className="text-sm text-muted-foreground">
            {program.source.catalog} · {major.satisfied} of {major.total} requirements satisfied
            {program.approxCredits ? ` · about ${program.approxCredits} credits in the major` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-normal">
            {program.review.status === "reviewed" ? "Reviewed transcription" : "Draft transcription"}
          </Badge>
          <a href={program.source.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Catalog page
            <ExternalLink />
          </a>
        </div>
      </div>

      <nav aria-label="Requirements" className="flex flex-wrap gap-1.5">
        {major.requirements.map((r) => (
          <a
            key={r.requirement.id}
            href={`#${r.requirement.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted"
          >
            <StatusIcon status={r.status} className="size-3.5" />
            {requirementHeading(r.requirement)}
          </a>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2" aria-label="Major requirements">
          {major.requirements.map((result) => (
            <RequirementCard key={result.requirement.id} result={result} labels={labels} attempts={attempts} />
          ))}
        </section>

        <aside className="space-y-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Program rules</CardTitle>
              <CardDescription>Grade, GPA, and residency rules that apply across requirements.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {major.policies.map((p, i) => {
                  const { icon: Icon, className } = POLICY_ICONS[p.status];
                  return (
                    <li key={i} className="flex gap-2 text-sm">
                      <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} aria-hidden />
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-medium">
                          {POLICY_TITLES[p.policy.type] ?? p.policy.type}
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{POLICY_STATUS_LABELS[p.status]}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{p.detail}</p>
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">Catalog text</summary>
                          <p className="mt-1 text-muted-foreground">{p.policy.sourceText}</p>
                        </details>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {substitutions.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Allowed substitutions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  {substitutions.map((s) => (
                    <li key={s.id}>
                      {s.sourceText}
                      {s.requiresApproval && (
                        <Badge variant="outline" className="ml-1.5 font-normal">
                          Needs approval
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card size="sm">
            <CardHeader>
              <CardTitle>Stony Brook Curriculum</CardTitle>
              <CardDescription>
                {audit.sbc.satisfied} of {audit.sbc.total} satisfied or exempt
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {audit.sbc.results.map((s) => (
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
              <p className="mt-3 text-xs text-muted-foreground">
                Upper-tier objectives (EXP+, HFA+, SBS+, STEM+) aren&apos;t audited yet.
              </p>
            </CardContent>
          </Card>

          {program.notes.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Notes from the catalog</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  {program.notes.map((n, i) => (
                    <li key={i}>
                      <span className="font-medium text-foreground">{NOTE_TOPICS[n.topic] ?? n.topic}: </span>
                      {n.text}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
