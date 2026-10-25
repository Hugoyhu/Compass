"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2, MoreHorizontal, Plus, TriangleAlert, X } from "lucide-react";
import { generatePlanAction, savePlan, setMinTermCredits, setTargetTerms } from "@/app/actions/plan";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { selectClassName } from "@/components/record/options";
import { slugFor } from "@/lib/domain/course-slug";
import { formatTerm } from "@/lib/domain/terms";
import type { PlannedTerm, PlanItem, SbcCode, TermId } from "@/lib/domain/types";
import type { CheckedItem, CheckedTerm } from "@/lib/engine/plan";
import type { PlanView } from "@/lib/services/plan";
import { cn } from "@/lib/utils";
import { formatProgramName } from "@/lib/domain/program-name";

const ELECTIVE_CREDITS = 3;
const FULL_TIME_CREDITS = 12;
/** Fewest credits a fall or spring semester may have: part time below 12, up to 19 without approval. */
const MIN_CREDIT_OPTIONS = [0, 3, 6, 9, 12, 13, 14, 15, 16, 17, 18, 19];

function toItem(i: CheckedItem): PlanItem {
  if (i.code) return { code: i.code };
  if (i.sbc) return { sbc: i.sbc };
  if (i.slot) return { slot: i.slot.requirementId, credits: i.credits, ...(i.slot.also.length > 0 && { also: i.slot.also }) };
  return { elective: i.credits };
}

function toPlan(terms: CheckedTerm[]): PlannedTerm[] {
  return terms.map((t) => ({ term: t.term, items: t.items.map(toItem) }));
}

/** The semester-by-semester plan: generate it, then move, swap, and fill in courses. */
export function PlanEditor({ view }: { view: PlanView }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const plan = toPlan(view.terms);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
    });
  }
  const save = (next: PlannedTerm[]) => run(() => savePlan(next));
  const setItems = (index: number, items: PlanItem[]) => save(plan.map((t, i) => (i === index ? { ...t, items } : t)));

  function move(from: number, itemIndex: number, to: TermId) {
    const item = plan[from].items[itemIndex];
    save(
      plan.map((t, i) => {
        if (i === from) return { ...t, items: t.items.filter((_, j) => j !== itemIndex) };
        if (t.term === to) return { ...t, items: [...t.items, item] };
        return t;
      }),
    );
  }

  const { projection } = view;
  const filled = plan.filter((t) => t.items.length > 0).length;

  return (
    <div className={cn("space-y-8", pending && "pointer-events-none opacity-70 transition-opacity")} aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium">
            <label className="flex items-center gap-2">
              Graduate in
              <select
                className={cn(selectClassName, "h-8 w-auto")}
                value={view.target.terms}
                onChange={(e) => run(() => setTargetTerms(Number(e.target.value)))}
              >
                {view.target.options.map((o) => (
                  <option key={o.terms} value={o.terms}>
                    {o.terms} semesters · {formatTerm(o.last)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              At least
              <select
                className={cn(selectClassName, "h-8 w-auto")}
                value={view.minCredits}
                onChange={(e) => run(() => setMinTermCredits(Number(e.target.value)))}
              >
                {MIN_CREDIT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === FULL_TIME_CREDITS ? `${n} (full time)` : n}
                  </option>
                ))}
              </select>
              credits a semester
            </label>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {filled > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => confirm("Clear every semester of your plan?") && save([])}
            >
              Clear
            </Button>
          )}
          <Button size="sm" onClick={() => run(generatePlanAction)} disabled={!view.hasPrograms}>
            Generate
          </Button>
        </div>
      </div>

      {view.target.beyond.length > 0 && (
        <p role="status" className="flex items-start gap-2 border-l-4 border-status-progress py-1 pl-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-progress" aria-hidden />
          <span>
            {view.target.beyond.map(formatTerm).join(", ")} {view.target.beyond.length === 1 ? "runs" : "run"} past your{" "}
            {view.target.terms}-semester goal.{" "}
            {view.target.perTerm > view.target.maxCredits
              ? `Finishing by ${formatTerm(view.target.last)} would take about ${view.target.perTerm} credits a semester, more than the ${view.target.maxCredits} allowed without approval. Choose more semesters, or add summer and winter courses.`
              : "Move those courses earlier, or clear the plan and generate again."}
          </span>
        </p>
      )}

      {!view.hasPrograms && (
        <p className="border-l-4 border-foreground py-1 pl-4 text-sm">
          Add a program to plan its requirements.{" "}
          <Link href="/degrees" className="underline underline-offset-4">
            Browse programs
          </Link>
        </p>
      )}

      {view.undeclared.length > 0 && (
        <ul className="space-y-1 border-l-4 border-foreground py-1 pl-4 text-sm">
          {view.undeclared.map((u) => (
            <li key={u.href}>
              {u.program}: no {u.kind} chosen yet, so the plan follows the closest one.{" "}
              <Link href={u.href} className="underline underline-offset-4">
                Choose
              </Link>
            </li>
          ))}
        </ul>
      )}

      {filled > 0 && <Summary projection={projection} />}

      {plan.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-y py-6">
          <p className="flex-1 text-sm text-muted-foreground">No semesters planned yet.</p>
          <AddTerm options={view.termOptions} onAdd={(term) => save([{ term, items: [] }])} />
        </div>
      ) : (
        <div className="grid gap-x-6 gap-y-8 md:grid-cols-2">
          {view.terms.map((term, index) => (
            <TermColumn
              key={term.term}
              term={term}
              otherTerms={plan.filter((_, i) => i !== index).map((t) => t.term)}
              view={view}
              onAdd={(item) => setItems(index, [...plan[index].items, item])}
              onReplace={(itemIndex, item) => setItems(index, plan[index].items.map((it, j) => (j === itemIndex ? item : it)))}
              onRemove={(itemIndex) => setItems(index, plan[index].items.filter((_, j) => j !== itemIndex))}
              onMove={(itemIndex, to) => move(index, itemIndex, to)}
              onRemoveTerm={() => save(plan.filter((_, i) => i !== index))}
            />
          ))}
          <div className="flex items-start">
            <AddTerm options={view.termOptions} onAdd={(term) => save([...plan, { term, items: [] }])} />
          </div>
        </div>
      )}

      <datalist id="plan-courses">
        {view.courses.map((c) => (
          // The label repeats the code without its space, so "POL369" finds POL 369 too.
          <option key={c.code} value={c.code}>
            {`${c.code.replace(" ", "")} · ${c.title}`}
          </option>
        ))}
      </datalist>
    </div>
  );
}

function Summary({ projection }: { projection: PlanView["projection"] }) {
  const stats = [
    { label: "Graduation", value: projection.graduation ? formatTerm(projection.graduation) : "Not yet" },
    { label: "Credits", value: `${projection.credits.planned}/${projection.credits.required}` },
    { label: "Upper division", value: `${projection.upperDivision.planned}/${projection.upperDivision.required}` },
    { label: "SBC", value: `${projection.sbc.done}/${projection.sbc.total}` },
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y-2 border-foreground py-5 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="space-y-1">
            <dt className="text-sm text-muted-foreground">{s.label}</dt>
            <dd className="text-3xl font-bold tracking-tight tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {projection.programs.map((p) => (
          <li key={p.id} className={cn(p.done < p.total && "text-muted-foreground")}>
            {formatProgramName(p.name)} <span className="tabular-nums">{p.done}/{p.total}</span>
          </li>
        ))}
      </ul>
      {projection.open.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
            {projection.open.length} still open after this plan
          </summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {projection.open.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </details>
      )}
      {projection.review.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
            {projection.review.length} for an advisor to confirm
          </summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {projection.review.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TermColumn({
  term,
  otherTerms,
  view,
  onAdd,
  onReplace,
  onRemove,
  onMove,
  onRemoveTerm,
}: {
  term: CheckedTerm;
  otherTerms: TermId[];
  view: PlanView;
  onAdd: (item: PlanItem) => void;
  onReplace: (index: number, item: PlanItem) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, to: TermId) => void;
  onRemoveTerm: () => void;
}) {
  return (
    <section aria-label={formatTerm(term.term)} className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3 border-b-2 border-foreground pb-2">
        <h3 className="text-base font-bold tracking-tight">{formatTerm(term.term)}</h3>
        <span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
          {term.credits} cr
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${formatTerm(term.term)}`}
            onClick={() => (term.items.length === 0 || confirm(`Remove ${formatTerm(term.term)} from your plan?`)) && onRemoveTerm()}
          >
            <X />
          </Button>
        </span>
      </div>
      {term.problems.map((p) => (
        <p key={p} className="mt-2 flex items-center gap-1.5 text-xs text-status-progress">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {p}
        </p>
      ))}
      <ul className="flex-1">
        {term.items.map((item, index) => (
          <ItemRow
            key={`${item.code ?? item.sbc ?? item.slot?.requirementId ?? "elective"}-${index}`}
            item={item}
            term={term.term}
            otherTerms={otherTerms}
            options={item.slot ? (view.slotOptions[item.slot.requirementId] ?? []) : []}
            onReplace={(next) => onReplace(index, next)}
            onRemove={() => onRemove(index)}
            onMove={(to) => onMove(index, to)}
          />
        ))}
      </ul>
      <div className="border-t pt-2">
        <AddCourse courses={view.courses} sbcCategories={view.sbcCategories} onAdd={onAdd} />
      </div>
    </section>
  );
}

function ItemRow({
  item,
  term,
  otherTerms,
  options,
  onReplace,
  onRemove,
  onMove,
}: {
  item: CheckedItem;
  term: TermId;
  otherTerms: TermId[];
  /** Courses that can fill an elective slot. */
  options: PlanView["slotOptions"][string];
  onReplace: (item: PlanItem) => void;
  onRemove: () => void;
  onMove: (to: TermId) => void;
}) {
  const label = item.code ?? (item.sbc ? `SBC ${item.sbc}` : item.slot ? "Elective" : null);
  const name = item.code ?? item.title;
  return (
    <li className={cn("flex items-start gap-2 border-b py-2", item.slot && "my-1 border border-dashed border-foreground/40 px-2")}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex items-baseline gap-2 text-sm">
          <span className="w-16 shrink-0 font-mono text-xs">
            {item.code ? (
              <Link href={`/courses/${slugFor(item.code)}`} className="underline-offset-4 hover:underline">
                {item.code}
              </Link>
            ) : (
              (label ?? "—")
            )}
          </span>
          <span title={item.title} className={cn("min-w-0 truncate", !item.code && !item.slot && "text-muted-foreground italic")}>
            {item.title}
          </span>
        </p>
        {item.counts.length > 0 && <p className="truncate pl-[4.5rem] text-xs text-muted-foreground">{item.counts.join(" · ")}</p>}
        {item.slot?.option && !item.slot.option.declared && (
          <p className="pl-[4.5rem] text-xs text-muted-foreground">Closest match; no {item.slot.option.kind} chosen yet</p>
        )}
        {item.slot && options.length > 0 && (
          <div className="pl-[4.5rem]">
            <select
              aria-label={`Choose a course for ${item.title}`}
              className={cn(selectClassName, "h-7 w-full max-w-64 text-xs")}
              value=""
              onChange={(e) => e.target.value && onReplace({ code: e.target.value })}
            >
              <option value="">Choose a course…</option>
              {options.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} {c.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {item.schedule === "not-scheduled" && (
          <p className="pl-[4.5rem] text-xs text-muted-foreground">Not on the {formatTerm(term)} schedule</p>
        )}
        {item.checks.map((c) => (
          <p key={c} className="pl-[4.5rem] text-xs text-muted-foreground">
            Requires {c.charAt(0).toLowerCase() + c.slice(1)}
          </p>
        ))}
        {item.problems.map((p) => (
          <p key={p} className="flex items-start gap-1 pl-[4.5rem] text-xs text-status-critical">
            <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
            {p}
          </p>
        ))}
      </div>
      <span className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">{item.credits}</span>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Options for ${name}`} />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {otherTerms.map((t) => (
            <DropdownMenuItem key={t} onClick={() => onMove(t)}>
              Move to {formatTerm(t)}
            </DropdownMenuItem>
          ))}
          {otherTerms.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function AddCourse({
  courses,
  sbcCategories,
  onAdd,
}: {
  courses: PlanView["courses"];
  sbcCategories: PlanView["sbcCategories"];
  onAdd: (item: PlanItem) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = code.toUpperCase().replace(/^([A-Z]{3,4})\s*(\d{3}).*$/, "$1 $2");
    if (!courses.some((c) => c.code === normalized)) {
      setError("Not a catalog course");
      return;
    }
    onAdd({ code: normalized });
    setCode("");
    setError(null);
  }

  return (
    <form onSubmit={submit} className="w-full space-y-1">
      <div className="flex gap-1.5">
        <Input
          list="plan-courses"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Course code"
          aria-label="Course code"
          className="h-7 min-w-0 flex-1 text-sm"
        />
        <Button type="submit" variant="outline" size="sm" aria-label="Add course">
          <Plus />
          Add
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onAdd({ elective: ELECTIVE_CREDITS })}>
          Elective
        </Button>
        <select
          aria-label="Add an SBC course"
          className={cn(selectClassName, "h-7 w-auto shrink-0")}
          value=""
          onChange={(e) => e.target.value && onAdd({ sbc: e.target.value as SbcCode })}
        >
          <option value="">SBC…</option>
          {sbcCategories.map((c) => (
            <option key={c.code} value={c.code} title={c.name}>
              {c.code}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function AddTerm({ options, onAdd }: { options: TermId[]; onAdd: (term: TermId) => void }) {
  if (options.length === 0) return null;
  return (
    <select
      aria-label="Add a semester"
      className={cn(selectClassName, "w-auto")}
      value=""
      onChange={(e) => e.target.value && onAdd(e.target.value as TermId)}
    >
      <option value="">Add semester…</option>
      {options.map((t) => (
        <option key={t} value={t}>
          {formatTerm(t)}
        </option>
      ))}
    </select>
  );
}
