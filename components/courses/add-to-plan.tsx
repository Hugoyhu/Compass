"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { addCourseToPlan } from "@/app/actions/plan";
import { Button } from "@/components/ui/button";
import { selectClassName } from "@/components/record/options";
import { formatTerm } from "@/lib/domain/terms";
import type { TermId } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export function AddToPlan({ code, terms, plannedTerm }: { code: string; terms: TermId[]; plannedTerm: TermId | null }) {
  const [term, setTerm] = useState<TermId | "">(terms[0] ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (plannedTerm) {
    return (
      <Link href="/planner" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        Planned for {formatTerm(plannedTerm)}
      </Link>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <select aria-label="Term" className={cn(selectClassName, "h-7 w-auto")} value={term} onChange={(e) => setTerm(e.target.value as TermId)}>
        {terms.map((t) => (
          <option key={t} value={t}>
            {formatTerm(t)}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        disabled={!term || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await addCourseToPlan(code, term);
            setError(result.ok ? null : result.error);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Plus />}
        Add to plan
      </Button>
    </span>
  );
}
