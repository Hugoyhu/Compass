"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { kindLabel, kindsIn } from "@/lib/domain/program-kinds";
import { formatProgramName } from "@/lib/domain/program-name";
import type { ProgramSummary } from "@/lib/services/degrees";

type KindFilter = "all" | "mine" | ProgramSummary["kind"];

export function DegreeList({ programs, mine }: { programs: ProgramSummary[]; mine: string[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  // Removing your last program hides the "Mine" tab; fall back to everything.
  const activeKind = kind === "mine" && mine.length === 0 ? "all" : kind;
  const deferredQuery = useDeferredValue(query);

  const terms = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = programs.filter(
    (p) =>
      (activeKind === "all" || (activeKind === "mine" ? mine.includes(p.id) : p.kind === activeKind)) &&
      terms.every((t) => p.name.toLowerCase().includes(t) || p.degree?.toLowerCase().includes(t)),
  );
  const kinds = kindsIn(programs);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search majors, minors, and programs"
            className="pl-8"
          />
        </div>
        <Tabs value={activeKind} onValueChange={(v) => setKind(v as KindFilter)}>
          <TabsList>
            <TabsTrigger value="all">All ({programs.length})</TabsTrigger>
            {kinds.map((k) => (
              <TabsTrigger key={k} value={k}>
                {kindLabel(k, true)} ({programs.filter((p) => p.kind === k).length})
              </TabsTrigger>
            ))}
            {mine.length > 0 && <TabsTrigger value="mine">Mine ({mine.length})</TabsTrigger>}
          </TabsList>
        </Tabs>
      </div>

      {matches.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No matches
        </p>
      ) : (
        <ul className="divide-y border-y">
          {matches.map((p) => (
            <li key={p.id}>
              <Link href={`/degrees/${p.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium">{formatProgramName(p.name)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[p.degree, p.approxCredits && `${p.approxCredits} credits`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {mine.includes(p.id) && <Badge className="font-normal">Added</Badge>}
                <Badge variant="outline" className="hidden font-normal sm:inline-flex">
                  {kindLabel(p.kind)}
                </Badge>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
