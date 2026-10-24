import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ArrowLeftRight, ExternalLink } from "lucide-react";
import { RuleTree, type RuleContext } from "@/components/degrees/rule-tree";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProgramDefinition, ProgramPolicy, Rule, Substitution } from "@/lib/domain/catalog/program";
import { itemNumber, NOTE_TOPICS, POLICY_TITLES, requirementHeading } from "@/lib/engine/describe";
import { getProgramDetail, listProgramIds, type ProgramDetail } from "@/lib/services/degrees";

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
  const { byRequirement, unattached } = substitutionsByRequirement(program);
  const ctx: RuleContext = { courses: detail.courseInfo, refs: refs.full };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">{program.name}</h2>
          <p className="text-sm text-muted-foreground">
            {[program.degree ?? { major: "Major", minor: "Minor", program: "Special program" }[program.kind], program.approxCredits && `${program.approxCredits} credits`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={program.source.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Catalog page
            <ExternalLink />
          </a>
        </div>
      </div>

      {program.requirements.length > 1 && (
        <nav aria-label="Requirements" className="flex flex-wrap gap-1.5">
          {program.requirements.map((r) => (
            <a key={r.id} href={`#${r.id}`} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
              {requirementHeading(r)}
            </a>
          ))}
        </nav>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2" aria-label="Requirements">
          {program.requirements.map((r) => (
            <Card key={r.id} id={r.id} size="sm" className="scroll-mt-20">
              <CardHeader>
                <CardTitle className="text-sm">
                  {itemNumber(r.label) && <span className="mr-1.5 text-muted-foreground tabular-nums">{itemNumber(r.label)}.</span>}
                  {r.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <RuleTree rule={r.rule} ctx={ctx} />
                {byRequirement.get(r.id)?.map((sub) => <SubstitutionNote key={sub.id} sub={sub} />)}
                <CatalogText text={r.sourceText} />
              </CardContent>
            </Card>
          ))}
          {program.sampleSequence && program.sampleSequence.length > 0 && <SampleSequence detail={detail} />}
        </section>

        <aside className="space-y-4">
          {program.policies.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Program rules</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {program.policies.map((p, i) => (
                    <li key={i} className="space-y-0.5 text-sm">
                      <p className="font-medium">{POLICY_TITLES[p.type] ?? p.type}</p>
                      <p className="text-xs text-muted-foreground">{describePolicy(p, refs.short)}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {unattached.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Substitutions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  {unattached.map((s) => (
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

          {program.notes.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Notes</CardTitle>
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

function SubstitutionNote({ sub }: { sub: Substitution }) {
  return (
    <div className="flex gap-2 rounded-md border bg-muted/30 p-2 text-xs">
      <ArrowLeftRight className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">
          Substitution
          {sub.condition && <span className="font-normal text-muted-foreground"> · {sub.condition}</span>}
          {sub.requiresApproval && (
            <Badge variant="outline" className="ml-1.5 font-normal">
              Needs approval
            </Badge>
          )}
        </p>
        <p className="leading-relaxed text-muted-foreground">{sub.sourceText}</p>
      </div>
    </div>
  );
}

/**
 * Shows each substitution on every requirement it changes (one that names a
 * replaced course or contains the replaced rule), so alternatives like an
 * honors sequence appear next to the courses they replace.
 */
function substitutionsByRequirement(program: ProgramDefinition) {
  const byRequirement = new Map<string, Substitution[]>();
  const unattached: Substitution[] = [];
  const contents = program.requirements.map((r) => {
    const codes = new Set<string>();
    const ids = new Set<string>([r.id]);
    const visit = (rule: Rule) => {
      if (rule.id) ids.add(rule.id);
      if (rule.type === "course") codes.add(rule.code);
      if (rule.type === "choose") rule.from.courses?.forEach((c) => codes.add(c));
      if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach(visit);
    };
    visit(r.rule);
    return { id: r.id, codes, ids };
  });
  for (const sub of program.substitutions) {
    const targets = contents.filter(({ codes, ids }) =>
      sub.replaces.type === "courses" ? sub.replaces.courses.some((c) => codes.has(c)) : ids.has(sub.replaces.ruleId),
    );
    if (targets.length === 0) unattached.push(sub);
    targets.forEach(({ id }) => byRequirement.set(id, [...(byRequirement.get(id) ?? []), sub]));
  }
  return { byRequirement, unattached };
}

function CatalogText({ text }: { text: string }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">Catalog text</summary>
      <p className="mt-1.5 rounded-md bg-muted/50 p-2 leading-relaxed text-muted-foreground">{text}</p>
    </details>
  );
}

/**
 * Requirement ids, and ids of rules nested inside them, → how to refer to the
 * requirement: "requirement 3 (Title)" in full, "3" in a short list. Slug labels
 * aren't shown, so those requirements are referred to by title.
 */
function requirementRefs(program: ProgramDefinition): { full: Record<string, string>; short: Record<string, string> } {
  const full: Record<string, string> = {};
  const short: Record<string, string> = {};
  const visit = (rule: Rule, id: string) => {
    if (rule.id && !(rule.id in full)) {
      full[rule.id] = full[id];
      short[rule.id] = short[id];
    }
    if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach((r) => visit(r, id));
  };
  for (const r of program.requirements) {
    const n = itemNumber(r.label);
    full[r.id] = n ? `requirement ${n} (${r.title})` : `“${r.title}”`;
    short[r.id] = n ?? `“${r.title}”`;
    visit(r.rule, r.id);
  }
  return { full, short };
}

function describePolicy(p: ProgramPolicy, shortRefs: Record<string, string>): string {
  const ids = "appliesTo" in p ? p.appliesTo : [];
  const names = ids.map((id) => shortRefs[id] ?? id);
  const numbered = ids.every((id) => shortRefs[id] && !shortRefs[id].startsWith("“"));
  const scope =
    names.length === 0 ? "" : numbered ? ` in ${names.length === 1 ? "requirement" : "requirements"} ${names.join(", ")}` : ` in ${names.join(", ")}`;
  switch (p.type) {
    case "minGrade":
      return `${p.grade} or higher${scope}.`;
    case "letterGradeRequired":
      return `Courses${scope} must be taken for a letter grade.`;
    case "minGpa":
      return `${p.gpa.toFixed(2)} GPA or higher${scope}.`;
    case "residencyCredits":
      return `At least ${p.minCredits} credits${scope} must be taken at Stony Brook.`;
    case "residencyRequired":
      return `Courses${scope} must be taken at Stony Brook.`;
    case "prerequisiteGrade":
      return `${p.minGrade} or higher in ${p.subjects.join("/")} prerequisites${p.passNoCreditAllowed ? "" : "; no Pass/No Credit"}.`;
  }
}
