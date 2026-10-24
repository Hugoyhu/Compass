"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProgramSummary } from "@/lib/services/degrees";

type KindFilter = "all" | ProgramSummary["kind"];

export function DegreeList({ programs }: { programs: ProgramSummary[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const deferredQuery = useDeferredValue(query);

  const terms = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = programs.filter(
    (p) =>
      (kind === "all" || p.kind === kind) &&
      terms.every((t) => p.name.toLowerCase().includes(t) || p.degree?.toLowerCase().includes(t)),
  );
  const counts = {
    all: programs.length,
    major: programs.filter((p) => p.kind === "major").length,
    minor: programs.filter((p) => p.kind === "minor").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search majors and minors"
            aria-label="Search majors and minors"
            className="pl-8"
          />
        </div>
        <Tabs value={kind} onValueChange={(v) => setKind(v as KindFilter)}>
          <TabsList>
            <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
            <TabsTrigger value="major">Majors ({counts.major})</TabsTrigger>
            <TabsTrigger value="minor">Minors ({counts.minor})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {matches.length === programs.length ? `${programs.length} programs` : `${matches.length} of ${programs.length} programs`}
      </p>

      {matches.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No programs match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {matches.map((p) => (
            <li key={p.id}>
              <Link href={`/degrees/${p.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      p.degree,
                      `${p.requirementCount} ${p.requirementCount === 1 ? "requirement" : "requirements"}`,
                      p.approxCredits && `about ${p.approxCredits} credits`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Badge variant="outline" className="hidden font-normal capitalize sm:inline-flex">
                  {p.kind}
                </Badge>
                {p.unparsedCount > 0 && (
                  <Badge variant="outline" className="hidden font-normal md:inline-flex" title="Parts of this program are shown as catalog text only">
                    {p.unparsedCount} unstructured
                  </Badge>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
