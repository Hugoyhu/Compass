import Link from "next/link";
import { CalendarClock, CircleCheck, Clock, TriangleAlert } from "lucide-react";
import { slugFor } from "@/lib/domain/course-slug";
import type { ChooseConstraint, CourseSelector, Rule } from "@/lib/domain/catalog/program";
import type { CreditSource } from "@/lib/domain/types";
import type { CourseInfo } from "@/lib/services/degrees";
import type { CourseStatus } from "@/lib/services/progress";

export interface RuleContext {
  courses: Record<string, CourseInfo>;
  /** Requirement and rule ids → readable names, for "not already used in …" constraints. */
  refs: Record<string, string>;
  /** Student view only: the student's status per course. Absent in the catalog view. */
  status?: Record<string, CourseStatus>;
  /** Student view only: courses the audit applied to the requirement being shown. */
  applied?: Set<string>;
  /** Student view only: declared concentrations, choice rule id → alternative id. */
  choices?: Record<string, string>;
}

const SUBSTITUTION_PREFIX = "substitution:";

/** Every course code a rule names directly (not pools), e.g. to find applied courses the tree doesn't show. */
export function namedCourses(rule: Rule): Set<string> {
  const codes = new Set<string>();
  const visit = (r: Rule) => {
    if (r.type === "course") codes.add(r.code);
    if (r.type === "choose") r.from.courses?.forEach((c) => codes.add(c));
    if (r.type === "allOf" || r.type === "anyOf") r.rules.forEach(visit);
  };
  visit(rule);
  return codes;
}

/**
 * In the student view, every alternative but the one furthest along is faded:
 * the share of its named courses applied to this requirement decides, so a lab
 * shared by several pairings doesn't make them all look used.
 */
function unusedAlternative(alternative: Rule, siblings: Rule[], ctx: RuleContext): boolean {
  const { applied } = ctx;
  if (!applied?.size) return false;
  const share = (r: Rule) => {
    const codes = [...namedCourses(r)];
    return codes.length ? codes.filter((c) => applied.has(c)).length / codes.length : 0;
  };
  const best = Math.max(...siblings.map(share));
  return best > 0 && siblings.findIndex((r) => share(r) === best) !== siblings.indexOf(alternative);
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
        <Group label={rule.id?.startsWith(SUBSTITUTION_PREFIX) ? "Alternative path (in use)" : "All of"}>
          <RuleList rules={rule.rules} ctx={ctx} />
        </Group>
      );
    case "anyOf": {
      if (rule.choice) return <Choice rule={rule} ctx={ctx} />;
      // "CSE 373 or CSE 385" reads better inline than as a nested block.
      if (rule.rules.every((r) => r.type === "course" && !r.manualCheck)) {
        return (
          <div className="space-y-1">
            <ul className="space-y-1">
              {rule.rules.map((r, i) => (
                <li key={i} className={`flex items-baseline gap-2 ${unusedAlternative(r, rule.rules, ctx) ? "opacity-50" : ""}`}>
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
              <li key={i} className={`space-y-1.5 ${unusedAlternative(r, rule.rules, ctx) ? "opacity-50" : ""}`}>
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

/**
 * A concentration, specialization, or track. Once the student has chosen, only
 * that one is shown; otherwise each is a collapsed section with its name.
 */
function Choice({ rule, ctx }: { rule: Extract<Rule, { type: "anyOf" }>; ctx: RuleContext }) {
  const chosen = rule.id ? rule.rules.find((alt) => alt.id === ctx.choices?.[rule.id!]) : undefined;
  if (chosen) {
    return (
      <Group label={chosen.label ?? "Chosen"}>
        <RuleNode rule={chosen} ctx={ctx} />
      </Group>
    );
  }
  return (
    <Group label={`One ${rule.choice}`}>
      <ul className="space-y-1">
        {rule.rules.map((alt, i) => (
          <li key={alt.id ?? i}>
            <details className="group">
              <summary className="cursor-pointer text-sm select-none hover:text-foreground">{alt.label ?? `Option ${i + 1}`}</summary>
              <div className="mt-1.5 pl-3">
                <RuleNode rule={alt} ctx={ctx} />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </Group>
  );
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

export function CourseLine({ code, ctx }: { code: string; ctx: RuleContext }) {
  const info = ctx.courses[code];
  const status = ctx.status?.[code];
  return (
    <span className="flex items-baseline gap-2 text-sm">
      {info ? (
        <Link href={`/courses/${slugFor(code)}`} className="w-[4.5rem] shrink-0 font-mono text-xs underline-offset-4 hover:underline">
          {code}
        </Link>
      ) : (
        <span className="w-[4.5rem] shrink-0 font-mono text-xs">{code}</span>
      )}
      <span className={`min-w-0 flex-1 ${info ? "" : "text-muted-foreground italic"}`}>{info?.title ?? ""}</span>
      {info && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{info.credits}</span>}
      {ctx.status && (
        // A course counted toward another requirement keeps its mark, muted.
        <StatusMark status={status} elsewhere={Boolean(status && ctx.applied && !ctx.applied.has(code))} />
      )}
    </span>
  );
}

const SOURCE_LABELS: Partial<Record<CreditSource, string>> = { ap: "AP", transfer: "Transfer" };

/** Fixed-width status column so titles and credits stay aligned. Text, not just color. */
function StatusMark({ status, elsewhere }: { status?: CourseStatus; elsewhere: boolean }) {
  const base = "inline-flex w-24 shrink-0 items-center justify-end gap-1 self-center text-xs";
  if (!status) return <span className={base} aria-hidden />;
  if (elsewhere && (status.state === "completed" || status.state === "in-progress")) {
    return (
      <span className={`${base} opacity-50`} title="Counts toward another requirement">
        <StatusMark status={status} elsewhere={false} />
        <span className="sr-only"> (counts toward another requirement)</span>
      </span>
    );
  }
  switch (status.state) {
    case "completed": {
      const label = status.grade === "T" ? (SOURCE_LABELS[status.source ?? "sbu"] ?? "Credit") : status.grade;
      return (
        <span className={`${base} font-medium`}>
          <CircleCheck className="size-4 text-status-good" strokeWidth={2.75} aria-hidden />
          {label}
          <span className="sr-only"> (completed)</span>
        </span>
      );
    }
    case "in-progress":
      return (
        <span className={`${base} text-muted-foreground`}>
          <Clock className="size-4 text-status-progress" strokeWidth={2.75} aria-hidden />
          In progress
        </span>
      );
    case "planned":
      return (
        <span className={`${base} text-muted-foreground`}>
          <CalendarClock className="size-3.5" aria-hidden />
          Planned
        </span>
      );
    case "not-counted":
      return (
        <span className={`${base} text-muted-foreground`} title="Grade below the requirement's minimum">
          <TriangleAlert className="size-3.5 text-status-critical" aria-hidden />
          {status.grade} · retake
        </span>
      );
  }
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
    case "minFrom": {
      const also = k.countUsedBy?.length ? `, counting courses used for ${[...new Set(k.countUsedBy.map((id) => ctx.refs[id] ?? id))].join(", ")}` : "";
      return `At least ${k.minCourses} from ${describePool(k.from, ctx)}${also}.`;
    }
    case "onePerGroup":
      return `No more than one of each: ${k.groups.map((g) => g.join(" / ")).join("; ")}.`;
    case "notEquivalentTo":
      return `May not be equivalent to courses counted toward ${ctx.refs[k.requirementId] ?? k.requirementId}.`;
  }
}
