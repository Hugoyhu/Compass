"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, Clock } from "lucide-react";
import { selectClassName } from "@/components/record/options";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { slugFor } from "@/lib/domain/course-slug";
import type { OptionCard, OptionLane, ProgramOptions } from "@/lib/engine/program-options";
import { cn } from "@/lib/utils";
import type { CourseProgress } from "./typical-path";

const LEVELS = [1, 2, 3, 4];

/** A card's progress: taking any course that can stand in for it counts. */
function progressOf(card: OptionCard, progress: CourseProgress): "done" | "in-progress" | undefined {
  const states = [card.code, ...card.alsoCodes].map((c) => progress[c]);
  return states.includes("done") ? "done" : states.includes("in-progress") ? "in-progress" : undefined;
}

/** Every course that could count toward the program's open choices, by requirement and level. */
export function ProgramOptionsView({ options, progress = {} }: { options: ProgramOptions; progress?: CourseProgress }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [season, setSeason] = useState("");

  const cards = useMemo(() => new Map(options.lanes.flatMap((l) => l.cards ?? []).map((c) => [c.code, c])), [options]);
  const card = selected ? cards.get(selected) : undefined;
  // Lanes of one concentration sit together in a collapsible section named for it.
  const sections = useMemo(() => {
    const out: { key: string; group: OptionLane["group"]; lanes: OptionLane[] }[] = [];
    for (const lane of options.lanes) {
      const last = out[out.length - 1];
      if (lane.group && last?.group?.label === lane.group.label && last.group.kind === lane.group.kind) last.lanes.push(lane);
      else out.push({ key: lane.id, group: lane.group, lanes: [lane] });
    }
    return out;
  }, [options.lanes]);
  const related = new Set(card ? [card.code, ...card.needs, ...card.leadsTo] : []);
  // Hide only courses known not to run in the chosen season; unknown ones stay.
  const shows = (c: OptionCard) => !season || !c.seasons || c.seasons.includes(season as "Fall" | "Spring");

  const renderLane = (lane: OptionLane) => (
  <section key={lane.id} className="space-y-2 rounded-lg border p-3" aria-label={lane.title}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="text-sm font-semibold">{lane.title}</h3>
              <span className="text-xs text-muted-foreground">
                {lane.group ? "" : `${lane.pick} · `}{lane.total} {lane.total === 1 ? "course" : "courses"} to choose from
              </span>
            </div>
            {lane.cards === null ? (
              <p className="text-sm text-muted-foreground">Too many to list: {lane.description}</p>
            ) : (
              <div className="grid max-h-[26rem] grid-cols-2 gap-x-3 gap-y-2 overflow-y-auto md:grid-cols-4">
                {LEVELS.map((level) => {
                  const inLevel = lane.cards!.filter((c) => c.level === level && shows(c));
                  return (
                    <div key={level} className="space-y-1.5">
                      <p className="text-[11px] font-medium text-muted-foreground">{level}00s</p>
                      {inLevel.length === 0 && <p className="text-[11px] text-muted-foreground/60">None</p>}
                      {inLevel.map((c) => {
                        const state = progressOf(c, progress);
                        return (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => setSelected(selected === c.code ? null : c.code)}
                            aria-pressed={selected === c.code}
                            title={`${c.code} ${c.title}`}
                            className={cn(
                              "block w-full rounded-sm border border-foreground/25 bg-card px-2 py-1 text-left text-[11px] leading-tight transition-opacity",
                              selected === c.code && "ring-2 ring-primary",
                              card && !related.has(c.code) && "opacity-25",
                              card && related.has(c.code) && c.code !== card.code && "border-primary bg-primary/10",
                            )}
                          >
                            <span className="flex items-center justify-between gap-1">
                              <span className="font-mono font-semibold">{c.code}</span>
                              <span className="flex items-center gap-1 text-muted-foreground tabular-nums">
                                {state === "done" && <Check className="size-3 text-status-good" aria-label="Taken" />}
                                {state === "in-progress" && <Clock className="size-3 text-status-progress" aria-label="In progress" />}
                                {c.credits > 0 && `${c.credits} cr`}
                              </span>
                            </span>
                            <span className="block truncate">{c.title}</span>
                            {c.alsoCodes.length > 0 && <span className="block truncate text-muted-foreground">or {c.alsoCodes.join(", ")}</span>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
  </section>
  );

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>All options</CardTitle>
        <div className="pt-1">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Hide courses not offered in
            <select aria-label="Season" className={cn(selectClassName, "h-7 w-auto")} value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value="">No filter</option>
              <option value="Fall">Fall</option>
              <option value="Spring">Spring</option>
            </select>
          </label>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {sections.map((section) =>
          section.group ? (
            <details key={section.key} className="rounded-lg border">
              <summary className="cursor-pointer px-3 py-2 text-sm select-none">
                <span className="mr-1.5 text-xs text-muted-foreground">{section.group.kind}</span>
                <span className="font-semibold">{section.group.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {section.lanes.length} {section.lanes.length === 1 ? "group" : "groups"} of options
                </span>
              </summary>
              <div className="space-y-3 p-3 pt-0">{section.lanes.map(renderLane)}</div>
            </details>
          ) : (
            section.lanes.map(renderLane)
          ),
        )}

        {card && (
          <div className="space-y-1 text-sm">
            <p className="font-medium">
              <Link href={`/courses/${slugFor(card.code)}`} className="font-mono text-xs underline-offset-4 hover:underline">
                {card.code}
              </Link>{" "}
              {card.title}
            </p>
            <p className="text-xs text-muted-foreground">Prerequisites: {card.prerequisites}</p>
            <p className="text-xs text-muted-foreground">
              {card.seasons ? `Offered in ${card.seasons.join(" and ")}` : "Offering unknown"}
              {card.needs.length > 0 && ` · Builds on ${card.needs.join(", ")}`}
              {card.leadsTo.length > 0 && ` · Leads to ${card.leadsTo.join(", ")}`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
