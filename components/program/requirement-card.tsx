import { ArrowLeftRight, ShieldQuestion, TriangleAlert } from "lucide-react";
import { ProgressMeter } from "@/components/audit/progress-meter";
import { StatusBadge } from "@/components/audit/status-badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProgramRequirement, Substitution } from "@/lib/domain/catalog/program";
import type { RequirementResult, SubstitutionLayout } from "@/lib/engine/audit";
import { choicesIn, describeMissing, itemNumber, progressFractions } from "@/lib/engine/describe";
import { ChoicePicker } from "./choice-picker";
import { AlternativePath, CatalogText, CoveredNote, SubstitutionNote } from "./program-panels";
import { CourseLine, namedCourses, RuleTree, type RuleContext } from "./rule-tree";

/**
 * One requirement, the same in both views. Catalog view: the rule and its
 * alternatives. Student view (`result` given): the rule the audit evaluated,
 * with status on each course, progress, what's still needed, and problems.
 */
export function RequirementCard({
  requirement,
  ctx,
  layouts,
  substitutions,
  refs,
  result,
  activeSubstitutions = [],
}: {
  requirement: ProgramRequirement;
  ctx: RuleContext;
  /** Course substitutions and where they apply (substitutionLayouts). */
  layouts: SubstitutionLayout[];
  /** Other substitutions attached to this requirement, shown as catalog text. */
  substitutions: Substitution[];
  /** Full requirement names, for links between requirements. */
  refs: Record<string, string>;
  result?: RequirementResult;
  activeSubstitutions?: string[];
}) {
  // In use, a substitution is already part of the evaluated rule; only offer the inactive ones.
  const offered = layouts.filter((l) => !activeSubstitutions.includes(l.sub.id));
  const rule = result?.rule ?? requirement.rule;
  const cardCtx: RuleContext = result ? { ...ctx, applied: new Set(result.applied.map((a) => a.code)) } : ctx;
  // Applied courses the tree doesn't name, e.g. electives counted from a "choose" pool.
  const shown = namedCourses(rule);
  const counting = result?.applied.filter((a) => !shown.has(a.code)) ?? [];
  const missing = result && result.status !== "satisfied" ? result.missing.filter((m) => m.kind !== "course") : [];
  const number = itemNumber(requirement.label);

  return (
    <Card id={requirement.id} size="sm" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-sm">
          {number && <span className="mr-1.5 text-muted-foreground tabular-nums">{number}.</span>}
          {requirement.title}
        </CardTitle>
        {result && (
          <CardAction>
            <StatusBadge status={result.status} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {result && <Progress result={result} />}

        {result &&
          ctx.choices &&
          choicesIn(rule).map((choice) => <ChoicePicker key={choice.id} choice={choice} selected={ctx.choices?.[choice.id]} />)}

        <RuleTree rule={rule} ctx={cardCtx} />

        {counting.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium">Counting toward this requirement</p>
            <ul className="space-y-1">
              {counting.map((a) => (
                <li key={a.code}>
                  <CourseLine code={a.code} ctx={cardCtx} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {missing.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Still needed: </span>
            {missing.map(describeMissing).join("; ")}
          </p>
        )}

        {result?.issues.map((issue) => (
          <p key={issue} className="flex items-start gap-1.5 text-xs">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-status-critical" aria-hidden />
            <span>
              <span className="sr-only">Problem: </span>
              {issue}
            </span>
          </p>
        ))}
        {result?.manualChecks.map((check) => (
          <p key={check} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldQuestion className="mt-px size-3.5 shrink-0" aria-hidden />
            {check}
          </p>
        ))}
        {result?.notes.map((note) => (
          <p key={note} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ArrowLeftRight className="mt-px size-3.5 shrink-0" aria-hidden />
            {note}
          </p>
        ))}

        {offered
          .filter((l) => l.placedIn.id === requirement.id)
          .map((l) => (
            <AlternativePath key={l.sub.id} layout={l} ctx={cardCtx} />
          ))}
        {offered
          .filter((l) => l.covered.has(requirement.id))
          .map((l) => (
            <CoveredNote key={l.sub.id} layout={l} requirementId={requirement.id} placedInName={refs[l.placedIn.id]} />
          ))}
        {substitutions.map((sub) => (
          <SubstitutionNote key={sub.id} sub={sub} />
        ))}

        <CatalogText text={requirement.sourceText} />
      </CardContent>
    </Card>
  );
}

function Progress({ result }: { result: RequirementResult }) {
  const { completed, inProgress } = progressFractions(result);
  return (
    <div className="flex items-center gap-3">
      <ProgressMeter completed={completed} inProgress={inProgress} label={`${result.requirement.title} progress`} />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {result.completed}
        {result.inProgress > 0 && ` + ${result.inProgress}`} / {result.required}
        {result.unit === "credits" ? " cr" : result.required === 1 ? " course" : " courses"}
      </span>
    </div>
  );
}
