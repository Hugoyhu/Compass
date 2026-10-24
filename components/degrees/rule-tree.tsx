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
        </div>
      );
    case "allOf":
      return (
        <Group label="All of">
          <RuleList rules={rule.rules} ctx={ctx} />
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
        </Group>
      );
    }
    case "choose":
      return <Choose rule={rule} ctx={ctx} />;
    case "unparsed":
      return (
        <p className="text-sm leading-relaxed">{rule.text}</p>
      );
  }
}

function Choose({ rule, ctx }: { rule: Extract<Rule, { type: "choose" }>; ctx: RuleContext }) {
  const amount =
    rule.credits !== undefined
      ? `${rule.credits} credits`
      : `${rule.count ?? 1} ${(rule.count ?? 1) === 1 ? "course" : "courses"}`;
  const listed = rule.from.courses ?? [];
  const { sources, qualifiers } = describeSelectorParts(rule.from, ctx);

  // Lead with the broad pool when there is one, so a few named extras don't read as the whole list.
  return (
    <Group label={`Choose ${amount}`}>
      {sources.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {listed.length > 0 && (
        <div className="space-y-1">
          {sources.length > 0 && <p className="text-xs text-muted-foreground">Or:</p>}
          <ul className="space-y-1">
            {listed.map((code) => (
              <li key={code}>
                <CourseLine code={code} ctx={ctx} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {qualifiers.length > 0 && <p className="text-xs text-muted-foreground">Excluding {qualifiers.join("; ")}.</p>}
      {(rule.constraints ?? []).map((k, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          {describeConstraint(k, ctx)}
        </p>
      ))}
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
      <span className={`min-w-0 flex-1 ${info ? "" : "text-muted-foreground italic"}`}>{info?.title ?? ""}</span>
      {info && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{info.credits}</span>}
    </span>
  );
}

function describeRange(r: { subject: string; from: number; to: number }): string {
  return r.to >= 999 ? `${r.subject} courses numbered ${r.from} and above` : `${r.subject} ${r.from}–${r.to}`;
}

/**
 * A selector's non-listed sources (subjects, levels, ranges) and its exclusions.
 * Listed courses are rendered separately.
 */
function describeSelectorParts(sel: CourseSelector, ctx: RuleContext): { sources: string[]; qualifiers: string[] } {
  const sources: string[] = [];
  const level =
    sel.minNumber !== undefined && sel.maxNumber !== undefined
      ? ` numbered ${sel.minNumber}–${sel.maxNumber}`
      : sel.minNumber !== undefined
        ? ` numbered ${sel.minNumber} and above`
        : sel.maxNumber !== undefined
          ? ` numbered ${sel.maxNumber} and below`
          : "";
  const credits = sel.minCredits ? `, each at least ${sel.minCredits} credits` : "";
  if (sel.subjects?.length) sources.push(`${sel.subjects.join(", ")} courses${level}${credits}`);
  else if (sel.minNumber !== undefined && !sel.courses?.length && !sel.ranges?.length) sources.push(`Any course${level}${credits}`);
  sel.ranges?.forEach((r) => sources.push(describeRange(r)));

  const qualifiers: string[] = [];
  if (sel.excludeCourses?.length) qualifiers.push(sel.excludeCourses.join(", "));
  if (sel.excludeAttributes?.length) qualifiers.push(`${sel.excludeAttributes.join(", ")} courses`);
  if (sel.excludeUsedBy?.length) qualifiers.push(`courses already counted toward ${[...new Set(sel.excludeUsedBy.map((id) => ctx.refs[id] ?? id))].join(", ")}`);
  return { sources, qualifiers };
}

/** One-line summary of a selector, for constraints. */
function describePool(sel: CourseSelector, ctx: RuleContext): string {
  const { sources, qualifiers } = describeSelectorParts(sel, ctx);
  const all = [...sources.map((s) => s.replace(/^Any /, "any ")), ...(sel.courses ?? [])];
  const base = all.length ? all.join(", ") : "the listed courses";
  return qualifiers.length ? `${base} (excluding ${qualifiers.join("; ")})` : base;
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
      return `At most ${limit} from ${describePool(k.from, ctx)}.`;
    }
    case "minFrom":
      return `At least ${k.minCourses} from ${describePool(k.from, ctx)}.`;
    case "onePerGroup":
      return `No more than one of each: ${k.groups.map((g) => g.join(" / ")).join("; ")}.`;
    case "notEquivalentTo":
      return `May not be equivalent to courses counted toward ${ctx.refs[k.requirementId] ?? k.requirementId}.`;
  }
}
