"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2, MoreHorizontal, Plus, TriangleAlert, X } from "lucide-react";
import { generatePlanAction, savePlan, setMinTermCredits } from "@/app/actions/plan";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { selectClassName } from "@/components/record/options";
import { formatTerm } from "@/lib/domain/terms";
import type { PlannedTerm, PlanItem, TermId } from "@/lib/domain/types";
import type { CheckedItem, CheckedTerm } from "@/lib/engine/plan";
import type { PlanView } from "@/lib/services/plan";
import { cn } from "@/lib/utils";

const ELECTIVE_CREDITS = 3;
const MIN_CREDIT_OPTIONS = [0, 3, 6, 9, 12, 13, 14, 15, 16, 17, 18, 19];

function toPlan(terms: CheckedTerm[]): PlannedTerm[] {
  return terms.map((t) => ({
    term: t.term,
    items: t.items.map((i): PlanItem => (i.code ? { code: i.code } : { elective: i.credits })),
  }));
}

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

  function generate() {
    if (plan.length > 0 && !confirm("Replace your plan with a generated one?")) return;
    run(generatePlanAction);
  }

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

  return (
    <div className={cn("space-y-6", pending && "pointer-events-none opacity-70 transition-opacity")} aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Plan</h2>
        <div className="flex items-center gap-2">
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Min credits / term
            <select
              className={cn(selectClassName, "h-7 w-16")}
              value={view.minCredits}
              onChange={(e) => run(() => setMinTermCredits(Number(e.target.value)))}
            >
              {MIN_CREDIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {plan.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => confirm("Clear your plan?") && save([])}>
              Clear
            </Button>
          )}
          <Button size="sm" onClick={generate}>
            Generate
          </Button>
        </div>
      </div>

      {!view.hasPrograms && (
        <Alert>
          <AlertTitle>Add a program to plan its requirements</AlertTitle>
          <AlertAction>
            <Link href="/degrees" className={buttonVariants({ size: "sm", variant: "outline" })}>
              Browse programs
            </Link>
          </AlertAction>
        </Alert>
      )}

      {plan.length > 0 && <Summary projection={projection} />}

      {plan.length === 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-muted-foreground">No plan yet.</p>
            <AddTerm options={view.termOptions} onAdd={(term) => save([{ term, items: [] }])} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {view.terms.map((term, index) => (
            <TermCard
              key={term.term}
              term={term}
              otherTerms={plan.filter((_, i) => i !== index).map((t) => t.term)}
              courses={view.courses}
              onAdd={(item) => setItems(index, [...plan[index].items, item])}
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
          <option key={c.code} value={c.code}>
            {c.title}
          </option>
        ))}
      </datalist>
    </div>
  );
}

function Summary({ projection }: { projection: PlanView["projection"] }) {
  const stats = [
    ...projection.programs.map((p) => ({ label: p.name, value: `${p.done}/${p.total}`, done: p.done === p.total })),
    { label: "SBC", value: `${projection.sbc.done}/${projection.sbc.total}`, done: projection.sbc.done >= projection.sbc.total },
    {
      label: "Credits",
      value: `${projection.credits.planned}/${projection.credits.required}`,
      done: projection.credits.planned >= projection.credits.required,
    },
    {
      label: "Upper-division",
      value: `${projection.upperDivision.planned}/${projection.upperDivision.required}`,
      done: projection.upperDivision.planned >= projection.upperDivision.required,
    },
  ];
  return (
    <Card size="sm">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Graduation</p>
            <p className="text-lg font-semibold">{projection.graduation ? formatTerm(projection.graduation) : "Not yet"}</p>
          </div>
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <p className="max-w-48 truncate text-xs text-muted-foreground">{s.label}</p>
              <p className={cn("text-lg font-semibold tabular-nums", !s.done && "text-muted-foreground")}>{s.value}</p>
            </div>
          ))}
        </div>
        {projection.open.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
              {projection.open.length} still open
            </summary>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {projection.open.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </details>
        )}
        {projection.review.length > 0 && (
          <details className="text-xs">
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
      </CardContent>
    </Card>
  );
}

function TermCard({
  term,
  otherTerms,
  courses,
  onAdd,
  onRemove,
  onMove,
  onRemoveTerm,
}: {
  term: CheckedTerm;
  otherTerms: TermId[];
  courses: PlanView["courses"];
  onAdd: (item: PlanItem) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, to: TermId) => void;
  onRemoveTerm: () => void;
}) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <CardTitle>{formatTerm(term.term)}</CardTitle>
        <CardDescription className="tabular-nums">{term.credits} credits</CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${formatTerm(term.term)}`}
            onClick={() => (term.items.length === 0 || confirm(`Remove ${formatTerm(term.term)} from your plan?`)) && onRemoveTerm()}
          >
            <X />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 space-y-2">
        {term.problems.map((p) => (
          <p key={p} className="flex items-center gap-1.5 text-xs text-[#a86f00]">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            {p}
          </p>
        ))}
        {term.items.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {term.items.map((item, index) => (
              <ItemRow
                key={`${item.code ?? "elective"}-${index}`}
                item={item}
                term={term.term}
                otherTerms={otherTerms}
                onRemove={() => onRemove(index)}
                onMove={(to) => onMove(index, to)}
              />
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="border-t bg-muted/30 py-2">
        <AddCourse courses={courses} onAdd={onAdd} />
      </CardFooter>
    </Card>
  );
}

function ItemRow({
  item,
  term,
  otherTerms,
  onRemove,
  onMove,
}: {
  item: CheckedItem;
  term: TermId;
  otherTerms: TermId[];
  onRemove: () => void;
  onMove: (to: TermId) => void;
}) {
  const name = item.code ?? "elective";
  return (
    <li className="flex items-start gap-2 py-1.5 pr-1 pl-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex items-baseline gap-2 text-sm">
          <span className="w-16 shrink-0 font-mono text-xs">{item.code ?? "—"}</span>
          <span title={item.title} className={cn("min-w-0 truncate", !item.code && "text-muted-foreground italic")}>
            {item.title}
          </span>
        </p>
        {item.counts.length > 0 && <p className="truncate pl-[4.5rem] text-xs text-muted-foreground">{item.counts.join(" · ")}</p>}
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

function AddCourse({ courses, onAdd }: { courses: PlanView["courses"]; onAdd: (item: PlanItem) => void }) {
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
          placeholder="CSE 214"
          aria-label="Course code"
          className="h-7 text-sm"
        />
        <Button type="submit" variant="outline" size="sm" aria-label="Add course">
          <Plus />
          Add
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onAdd({ elective: ELECTIVE_CREDITS })}>
          Elective
        </Button>
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
      aria-label="Add a term"
      className={cn(selectClassName, "w-auto")}
      value=""
      onChange={(e) => e.target.value && onAdd(e.target.value as TermId)}
    >
      <option value="">Add term…</option>
      {options.map((t) => (
        <option key={t} value={t}>
          {formatTerm(t)}
        </option>
      ))}
    </select>
  );
}
