"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { slugFor } from "@/lib/domain/course-slug";
import type { PathCard, TypicalPath } from "@/lib/engine/typical-path";
import { cn } from "@/lib/utils";

const COL_W = 176;
const COL_GAP = 30;
const HEAD_H = 0;
const CARD_H = 62;
const ROW_GAP = 10;
const OTHER_LINE = 15;
const PAD = 12;

export type CourseProgress = Record<string, "done" | "in-progress">;

/** Walks `next` from `start`, collecting everything reachable. */
function reach(start: string, next: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    for (const id of next.get(stack.pop()!) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(id);
    }
  }
  return seen;
}

/** A card's progress: taking any course that can stand in for it counts. */
function progressOf(card: PathCard, progress: CourseProgress): "done" | "in-progress" | undefined {
  const states = [card.code, ...card.alsoCodes].map((c) => progress[c]);
  return states.includes("done") ? "done" : states.includes("in-progress") ? "in-progress" : undefined;
}

/** The usual path through a major, from first courses on the left to last on the right. */
export function TypicalPathView({ path, progress = {} }: { path: TypicalPath; progress?: CourseProgress }) {
  const [selected, setSelected] = useState<string | null>(null);

  const { needs, unlocks } = useMemo(() => {
    const needs = new Map<string, string[]>();
    const unlocks = new Map<string, string[]>();
    for (const e of path.edges) {
      needs.set(e.to, [...(needs.get(e.to) ?? []), e.from]);
      unlocks.set(e.from, [...(unlocks.get(e.from) ?? []), e.to]);
    }
    return { needs, unlocks };
  }, [path.edges]);

  const colX = (col: number) => PAD + col * (COL_W + COL_GAP);
  const cardY = (row: number) => HEAD_H + PAD + row * (CARD_H + ROW_GAP);
  const pos = new Map(path.cards.map((c) => [c.code, { x: colX(c.col), y: cardY(c.row) }]));
  const width = PAD * 2 + path.columns.length * COL_W + (path.columns.length - 1) * COL_GAP;
  const height =
    Math.max(
      ...path.columns.map((col, i) => {
        const rows = path.cards.filter((c) => c.col === i).length;
        return cardY(rows) + col.other.length * OTHER_LINE;
      }),
    ) + PAD;

  const focus = selected ? new Set([selected, ...reach(selected, needs), ...reach(selected, unlocks)]) : null;
  const card = selected ? path.cards.find((c) => c.code === selected) : undefined;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Typical path</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-lg border bg-background">
          <div className="relative" style={{ width, height }}>
            {path.columns.map((col, i) => (
              <div key={i} className="absolute top-0 bottom-0" style={{ left: colX(i) - COL_GAP / 2, width: COL_W + COL_GAP }}>
                {i > 0 && <div className="absolute inset-y-0 left-0 border-l border-dashed" />}
              </div>
            ))}
            <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
              {path.edges.map((e) => {
                const from = pos.get(e.from);
                const to = pos.get(e.to);
                if (!from || !to) return null;
                const x1 = from.x + COL_W;
                const y1 = from.y + CARD_H / 2;
                const x2 = to.x;
                const y2 = to.y + CARD_H / 2;
                const dx = Math.max(20, (x2 - x1) / 2);
                const active = focus ? focus.has(e.from) && focus.has(e.to) : false;
                return (
                  <path
                    key={`${e.from}>${e.to}`}
                    d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    strokeWidth={active ? 2 : 1.25}
                    strokeDasharray={e.alternative ? "4 3" : undefined}
                    className={cn("stroke-foreground", focus ? (active ? "opacity-80" : "opacity-5") : "opacity-35")}
                  />
                );
              })}
            </svg>

            {path.cards.map((c) => {
              const p = pos.get(c.code)!;
              const state = progressOf(c, progress);
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setSelected(selected === c.code ? null : c.code)}
                  aria-pressed={selected === c.code}
                  className={cn(
                    "absolute flex flex-col justify-center rounded-sm border border-foreground/25 bg-card px-2 text-left text-[11px] leading-tight transition-opacity",
                    selected === c.code && "ring-2 ring-primary",
                    focus && !focus.has(c.code) && "opacity-25",
                  )}
                  style={{ left: p.x, top: p.y, width: COL_W, height: CARD_H }}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="font-mono font-semibold">{c.code}</span>
                    <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
                      {state === "done" && <Check className="size-4 text-status-good" strokeWidth={3} aria-label="Taken" />}
                      {state === "in-progress" && <Clock className="size-4 text-status-progress" strokeWidth={2.75} aria-label="In progress" />}
                      {c.credits > 0 && `${c.credits} cr`}
                    </span>
                  </span>
                  <span className="truncate">{c.title || "Not in catalog"}</span>
                  {c.alsoCodes.length > 0 && <span className="truncate text-muted-foreground">or {c.alsoCodes.join(", ")}</span>}
                </button>
              );
            })}

            {path.columns.map((col, i) => (
              <div
                key={`o-${i}`}
                className="absolute text-[11px] leading-[15px] text-muted-foreground"
                style={{ left: colX(i), top: cardY(path.cards.filter((c) => c.col === i).length), width: COL_W }}
              >
                {col.other.map((o) => (
                  <p key={o} className="truncate">
                    + {o}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>

        {card && (
          <div className="space-y-1 text-sm">
            <p className="font-medium">
              <Link href={`/courses/${slugFor(card.code)}`} className="font-mono text-xs underline-offset-4 hover:underline">
                {card.code}
              </Link>{" "}
              {card.title}
            </p>
            <p className="text-xs text-muted-foreground">Prerequisites: {card.prerequisites}</p>
            {card.alsoCodes.length > 0 && <p className="text-xs text-muted-foreground">Can be replaced by {card.alsoCodes.join(", ")}</p>}
            <p className="text-xs text-muted-foreground">
              {(needs.get(card.code) ?? []).length > 0 ? `Builds on ${(needs.get(card.code) ?? []).join(", ")}` : "Starts a chain"}
              {(unlocks.get(card.code) ?? []).length > 0 && ` · Leads to ${(unlocks.get(card.code) ?? []).join(", ")}`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
