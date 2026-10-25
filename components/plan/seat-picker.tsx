"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { swapCourse } from "@/app/actions/record";
import { selectClassName } from "@/components/record/options";
import type { RoadmapSeat } from "@/lib/engine/roadmap";
import { cn } from "@/lib/utils";

/** One course of a "choose from this list" requirement, swappable for another on the list. */
export function SeatPicker({ seat }: { seat: RoadmapSeat }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(code: string) {
    if (code === seat.selected.code) return;
    if (seat.planned && !confirm(`Taking ${code} removes ${seat.selected.code} from your plan. Continue?`)) return;
    startTransition(async () => {
      const result = await swapCourse(seat.selected.code, code);
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
      <select
        className={cn(selectClassName, "h-8 w-auto max-w-full")}
        value={seat.selected.code}
        disabled={pending}
        onChange={(e) => choose(e.target.value)}
        aria-label={`Course to take in place of ${seat.selected.code}`}
      >
        {seat.options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.code} · {o.title}
            {o.sbc.length > 0 && ` · ${o.sbc.join(", ")}`}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
