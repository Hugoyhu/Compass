"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { addProgram, removeProgram } from "@/app/actions/record";
import { Button } from "@/components/ui/button";

/** Adds a program to the visitor's record, or removes it. */
export function ProgramToggle({ programId, added, className }: { programId: string; added: boolean; className?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await (added ? removeProgram : addProgram)(programId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <Button variant={added ? "outline" : "default"} size="sm" onClick={toggle} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : added ? <X /> : <Plus />}
        {added ? "Remove" : "Add"}
      </Button>
    </span>
  );
}
