"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { chooseAlternative } from "@/app/actions/record";
import { selectClassName } from "@/components/record/options";
import type { RoadmapAlternative } from "@/lib/engine/roadmap";
import { cn } from "@/lib/utils";

const label = (alt: RoadmapAlternative) => alt.courses.map((c) => c.code).join(" + ");

/** Switches between the ways a requirement can be met, e.g. AMS 151/161 or MAT 125/126/127. */
export function AlternativePicker({ alternatives }: { alternatives: RoadmapAlternative[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = Math.max(0, alternatives.findIndex((a) => a.current));

  function choose(index: number) {
    if (index === current) return;
    if (alternatives[current].planned && !confirm(`Taking ${label(alternatives[index])} removes ${label(alternatives[current])} from your plan. Continue?`)) return;
    const others = alternatives.flatMap((a, i) => (i === index ? [] : a.courses.map((c) => c.code)));
    startTransition(async () => {
      const result = await chooseAlternative(
        alternatives[index].courses.map((c) => c.code),
        others,
      );
      if (result.ok) {
        setError(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Take</span>
        <select
          className={cn(selectClassName, "h-8 w-auto")}
          value={current}
          disabled={pending}
          onChange={(e) => choose(Number(e.target.value))}
          aria-label="Which courses to take"
        >
          {alternatives.map((alt, i) => (
            <option key={i} value={i}>
              {label(alt)}
              {alt.courses.length > 0 && ` · ${alt.courses.reduce((s, c) => s + c.credits, 0)} cr`}
            </option>
          ))}
        </select>
      </label>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
