"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { setChoice } from "@/app/actions/record";
import { selectClassName } from "@/components/record/options";
import type { ProgramChoice } from "@/lib/engine/describe";
import { cn } from "@/lib/utils";

/** Declares which concentration, specialization, or track the student is following. */
export function ChoicePicker({ choice, selected }: { choice: ProgramChoice; selected?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = choice.kind.charAt(0).toUpperCase() + choice.kind.slice(1);

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <select
        aria-label={label}
        className={cn(selectClassName, "w-auto max-w-full")}
        value={selected ?? ""}
        disabled={pending}
        onChange={(e) =>
          startTransition(async () => {
            const result = await setChoice(choice.id, e.target.value || null);
            setError(result.ok ? null : result.error);
          })
        }
      >
        <option value="">Not chosen</option>
        {choice.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}
