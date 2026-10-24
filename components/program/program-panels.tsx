/**
 * Pieces shared by the Degree Explorer (catalog view) and Degree Progress
 * (the same view with the student's status on top).
 */
import { ArrowLeftRight, CircleCheck, CircleDashed, CircleX, Clock, Info, type LucideIcon } from "lucide-react";
import { StatusIcon } from "@/components/audit/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProgramDefinition, ProgramPolicy, Substitution } from "@/lib/domain/catalog/program";
import type { PolicyResult, PolicyStatus, RequirementStatus, SubstitutionLayout } from "@/lib/engine/audit";
import { describePolicy, NOTE_TOPICS, POLICY_STATUS_LABELS, POLICY_TITLES, requirementHeading } from "@/lib/engine/describe";
import { RuleTree, type RuleContext } from "./rule-tree";

export function CatalogText({ text }: { text: string }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">Catalog text</summary>
      <p className="mt-1.5 rounded-md bg-muted/50 p-2 leading-relaxed text-muted-foreground">{text}</p>
    </details>
  );
}

/** Jump links to each requirement; with statuses in the student view. */
export function RequirementNav({
  requirements,
  statuses,
}: {
  requirements: { id: string; label: string; title: string }[];
  statuses?: Record<string, RequirementStatus>;
}) {
  if (requirements.length < 2) return null;
  return (
    <nav aria-label="Requirements" className="flex flex-wrap gap-1.5">
      {requirements.map((r) => (
        <a key={r.id} href={`#${r.id}`} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted">
          {statuses?.[r.id] && <StatusIcon status={statuses[r.id]} className="size-3.5" />}
          {requirementHeading(r)}
        </a>
      ))}
    </nav>
  );
}

const POLICY_ICONS: Record<PolicyStatus, { icon: LucideIcon; className: string }> = {
  satisfied: { icon: CircleCheck, className: "text-status-good" },
  "in-progress": { icon: Clock, className: "text-[#a86f00]" },
  "not-met": { icon: CircleX, className: "text-status-critical" },
  pending: { icon: CircleDashed, className: "text-muted-foreground" },
  info: { icon: Info, className: "text-muted-foreground" },
};

/** The program's rules in words; in the student view, each with its status and detail. */
export function ProgramRulesCard({
  policies,
  shortRefs,
  results,
}: {
  policies: ProgramPolicy[];
  shortRefs: Record<string, string>;
  results?: PolicyResult[];
}) {
  if (policies.length === 0) return null;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Program rules</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {policies.map((policy, i) => {
            const result = results?.[i];
            const icon = result && POLICY_ICONS[result.status];
            return (
              <li key={i} className="flex gap-2 text-sm">
                {icon && <icon.icon className={`mt-0.5 size-4 shrink-0 ${icon.className}`} aria-hidden />}
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    {POLICY_TITLES[policy.type] ?? policy.type}
                    {result && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{POLICY_STATUS_LABELS[result.status]}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{describePolicy(policy, shortRefs)}</p>
                  {result?.detail && result.status !== "info" && <p className="text-xs">{result.detail}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Substitutions that don't attach to any requirement. */
export function SubstitutionsCard({ substitutions }: { substitutions: Substitution[] }) {
  if (substitutions.length === 0) return null;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Substitutions</CardTitle>
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
  );
}

export function NotesCard({ notes }: { notes: ProgramDefinition["notes"] }) {
  if (notes.length === 0) return null;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-xs text-muted-foreground">
          {notes.map((n, i) => (
            <li key={i}>
              <span className="font-medium text-foreground">{NOTE_TOPICS[n.topic] ?? n.topic}: </span>
              {n.text}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** A course substitution shown as a path: the replacement courses, and what they replace. */
export function AlternativePath({ layout, ctx }: { layout: SubstitutionLayout; ctx: RuleContext }) {
  const { sub, replaced, covered } = layout;
  const elsewhere = [...covered.values()].flat();
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-medium">
        <ArrowLeftRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        Alternative path: replaces {replaced.join(", ")}
        {sub.condition && <span className="font-normal text-muted-foreground">· {sub.condition}</span>}
        {sub.requiresApproval && (
          <Badge variant="outline" className="font-normal">
            Needs approval
          </Badge>
        )}
      </p>
      <RuleTree rule={sub.with} ctx={ctx} />
      <p className="text-muted-foreground">
        {elsewhere.length > 0 && `Also covers ${elsewhere.join(", ")} in ${covered.size === 1 ? "another requirement" : "other requirements"}. `}
        Taking or planning any of these courses switches your audit to this path.
      </p>
      <CatalogText text={sub.sourceText} />
    </div>
  );
}

export function CoveredNote({ layout, requirementId, placedInName }: { layout: SubstitutionLayout; requirementId: string; placedInName: string }) {
  const codes = layout.covered.get(requirementId) ?? [];
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <ArrowLeftRight className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        {codes.join(", ")} can instead be covered by the alternative path in{" "}
        <a href={`#${layout.placedIn.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
          {placedInName}
        </a>{" "}
        ({layout.replacement.join(", ")}).
      </span>
    </p>
  );
}

/** A substitution that isn't a course list (e.g. senior design for a capstone), as catalog text. */
export function SubstitutionNote({ sub }: { sub: Substitution }) {
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
