import { FileQuestion, ShieldQuestion } from "lucide-react";
import type { ChooseConstraint, CourseSelector, Rule } from "@/lib/domain/catalog/program";
import type { CourseInfo } from "@/lib/services/degrees";

export interface RuleContext {
  courses: Record<string, CourseInfo>;
  /** Requirement and rule ids → readable names, for "not already used in …" constraints. */
  refs: Record<string, string>;
}

/** Read-only rendering of a requirement's rule tree, as a student would read it. */
export function RuleTree({ rule, ctx }: { rule: Rule; ctx: RuleContext }) {
  // A top-level "all of" is just the requirement's list; skip the extra heading.
  if (rule.type === "allOf") {
    return (
      <div className="space-y-2">
        <RuleList rules={rule.rules} ctx={ctx} />
        <ManualCheck rule={rule} />
      </div>
    );
  }
  return <RuleNode rule={rule} ctx={ctx} />;
}

function RuleList({ rules, ctx }: { rules: Rule[]; ctx: RuleContext }) {
  return (
    <ul className="space-y-1.5">
      {rules.map((r, i) => (
        <li key={i}>
          <RuleNode rule={r} ctx={ctx} />
        </li>
      ))}
    </ul>
  );
}

function RuleNode({ rule, ctx }: { rule: Rule; ctx: RuleContext }) {
  switch (rule.type) {
    case "course":
      return (
        <div className="space-y-1">
          <CourseLine code={rule.code} ctx={ctx} />
          <ManualCheck rule={rule} />
        </div>
      );
    case "allOf":
      return (
        <Group label="All of">
          <RuleList rules={rule.rules} ctx={ctx} />
          <ManualCheck rule={rule} />
        </Group>
      );
    case "anyOf": {
      // "CSE 373 or CSE 385" reads better inline than as a nested block.
      if (rule.rules.every((r) => r.type === "course" && !r.manualCheck)) {
        return (
          <div className="space-y-1">
            <ul className="space-y-1">
              {rule.rules.map((r, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="w-5 shrink-0 text-right text-[11px] text-muted-foreground">{i > 0 ? "or" : ""}</span>
                  <div className="min-w-0 flex-1">
                    <CourseLine code={(r as Extract<Rule, { type: "course" }>).code} ctx={ctx} />
                  </div>
                </li>
              ))}
            </ul>
            <ManualCheck rule={rule} />
          </div>
        );
      }
      return (
        <Group label="One of">
          <ul className="space-y-1.5">
            {rule.rules.map((r, i) => (
              <li key={i} className="space-y-1.5">
                {i > 0 && <p className="text-[11px] font-medium text-muted-foreground uppercase">or</p>}
                <RuleNode rule={r} ctx={ctx} />
              </li>
            ))}
          </ul>
          <ManualCheck rule={rule} />
        </Group>
      );
    }
    case "choose":
      return <Choose rule={rule} ctx={ctx} />;
    case "unparsed":
      return (
        <div className="space-y-1 rounded-md border border-dashed p-2 text-xs">
          <p className="flex items-center gap-1.5 font-medium">
            <FileQuestion className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            Not structured yet. Read the catalog wording:
          </p>
          <p className="leading-relaxed text-muted-foreground">{rule.text}</p>
          <ManualCheck rule={rule} />
        </div>
      );
  }
}

function Choose({ rule, ctx }: { rule: Extract<Rule, { type: "choose" }>; ctx: RuleContext }) {
  const amount =
    rule.credits !== undefined
      ? `${rule.credits} credits`
      : `${rule.count ?? 1} ${(rule.count ?? 1) === 1 ? "course" : "courses"}`;
  const listed = rule.from.courses ?? [];
  const pool = describePool(rule.from, ctx);

  return (
    <Group label={`Choose ${amount}`}>
      {listed.length > 0 && (
        <ul className="space-y-1">
          {listed.map((code) => (
            <li key={code}>
              <CourseLine code={code} ctx={ctx} />
            </li>
          ))}
        </ul>
      )}
      {pool && <p className="text-xs text-muted-foreground">{listed.length > 0 ? `Also: ${pool}` : `From ${pool}`}</p>}
      {(rule.constraints ?? []).map((k, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          {describeConstraint(k, ctx)}
        </p>
      ))}
      <ManualCheck rule={rule} />
    </Group>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-l-2 pl-3">
      <p className="text-xs font-medium">{label}</p>
      {children}
    </div>
  );
}

function CourseLine({ code, ctx }: { code: string; ctx: RuleContext }) {
  const info = ctx.courses[code];
  return (
    <span className="flex items-baseline gap-2 text-sm">
      <span className="w-[4.5rem] shrink-0 font-mono text-xs">{code}</span>
      <span className={`min-w-0 flex-1 ${info ? "" : "text-muted-foreground italic"}`}>{info?.title ?? "Not in course data"}</span>
      {info && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{info.credits}</span>}
    </span>
  );
}

function ManualCheck({ rule }: { rule: Rule }) {
  if (!rule.manualCheck) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <ShieldQuestion className="mt-px size-3.5 shrink-0" aria-hidden />
      Advisor check: {rule.manualCheck}
    </p>
  );
}

/** The non-listed part of a selector (subjects, levels, ranges) plus exclusions, or null when it only lists courses. */
function describePool(sel: CourseSelector, ctx: RuleContext): string | null {
  const parts: string[] = [];
  if (sel.subjects?.length) {
    const level =
      sel.minNumber !== undefined && sel.maxNumber !== undefined
        ? ` numbered ${sel.minNumber}–${sel.maxNumber}`
        : sel.minNumber !== undefined
          ? ` numbered ${sel.minNumber} or higher`
          : sel.maxNumber !== undefined
            ? ` numbered ${sel.maxNumber} or lower`
            : "";
    parts.push(`${sel.subjects.join(", ")} courses${level}`);
  } else if (sel.minNumber !== undefined && !sel.courses?.length && !sel.ranges?.length) {
    parts.push(`any course numbered ${sel.minNumber} or higher`);
  }
  sel.ranges?.forEach((r) => parts.push(`${r.subject} ${r.from}–${r.to}`));

  const qualifiers: string[] = [];
  if (sel.minCredits) qualifiers.push(`each at least ${sel.minCredits} credits`);
  if (sel.excludeCourses?.length) qualifiers.push(`not ${sel.excludeCourses.join(", ")}`);
  if (sel.excludeAttributes?.length) qualifiers.push(`excluding ${sel.excludeAttributes.join(", ")} courses`);
  if (sel.excludeUsedBy?.length) qualifiers.push(`not already counted toward ${sel.excludeUsedBy.map((id) => ctx.refs[id] ?? id).join(", ")}`);

  if (!parts.length && !qualifiers.length) return null;
  const base = parts.join(" or ") || "the listed courses";
  return qualifiers.length ? `${base} (${qualifiers.join("; ")})` : base;
}

function describeConstraint(k: ChooseConstraint, ctx: RuleContext): string {
  switch (k.type) {
    case "maxFrom": {
      const limit = [
        k.maxCourses !== undefined && `${k.maxCourses} ${k.maxCourses === 1 ? "course" : "courses"}`,
        k.maxCredits !== undefined && `${k.maxCredits} credits`,
      ]
        .filter(Boolean)
        .join(" or ");
      return `At most ${limit} from ${describePool(k.from, ctx) ?? listOf(k.from.courses)}.`;
    }
    case "minFrom":
      return `At least ${k.minCourses} from ${describePool(k.from, ctx) ?? listOf(k.from.courses)}.`;
    case "onePerGroup":
      return `No more than one of each: ${k.groups.map((g) => g.join(" / ")).join("; ")}.`;
    case "notEquivalentTo":
      return `May not be equivalent to courses counted toward ${ctx.refs[k.requirementId] ?? k.requirementId}.`;
  }
}

function listOf(codes: string[] | undefined): string {
  return codes?.length ? codes.join(", ") : "the listed courses";
}
