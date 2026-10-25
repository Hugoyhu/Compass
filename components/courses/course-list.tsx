"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { CalendarCheck, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectClassName } from "@/components/record/options";
import { slugFor } from "@/lib/domain/course-slug";
import { formatTerm } from "@/lib/domain/terms";
import type { TermId } from "@/lib/domain/types";
import type { CourseStatus, CourseSummary } from "@/lib/services/courses";
import { cn } from "@/lib/utils";
import { COURSE_STATUS_LABELS, CourseStatusBadge } from "./course-status";

const PAGE = 100;
const LEVELS = [100, 200, 300, 400];
const SBC = ["ARTS", "GLO", "HUM", "LANG", "QPS", "SBS", "SNW", "TECH", "USA", "WRT", "STAS", "EXP+", "HFA+", "SBS+", "STEM+", "CER", "DIV", "ESI", "SPK", "WRTD"];
const STATUS_FILTERS: CourseStatus[] = ["can-take", "planned", "in-progress", "taken", "prereqs-missing"];

export function CourseList({
  courses,
  scheduleTerm,
}: {
  courses: CourseSummary[];
  scheduleTerm: TermId | null;
}) {
  const subjects = useMemo(() => [...new Set(courses.map((c) => c.code.split(" ")[0]))].sort(), [courses]);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("");
  const [sbc, setSbc] = useState("");
  const [status, setStatus] = useState("");
  const [scheduledOnly, setScheduledOnly] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const deferredQuery = useDeferredValue(query);
  const hasStatus = courses.some((c) => c.status);

  // "cse214", "CSE 214", and words from the title all match.
  const terms = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = courses.filter(
    (c) =>
      (!subject || c.code.startsWith(`${subject} `)) &&
      (!level || c.code.split(" ")[1][0] === level[0]) &&
      (!sbc || c.sbc.includes(sbc)) &&
      (!status || c.status === status) &&
      (!scheduledOnly || c.scheduled) &&
      terms.every((t) => {
        const haystack = `${c.code.toLowerCase()} ${c.code.replace(" ", "").toLowerCase()} ${c.title.toLowerCase()}`;
        return haystack.includes(t);
      }),
  );

  // Changing a filter starts the list over.
  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setShown(PAGE);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => filter(setQuery)(e.target.value)}
            placeholder="Search by code or title"
            aria-label="Search courses"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Subject" className={cn(selectClassName, "w-auto")} value={subject} onChange={(e) => filter(setSubject)(e.target.value)}>
            <option value="">All subjects</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select aria-label="Level" className={cn(selectClassName, "w-auto")} value={level} onChange={(e) => filter(setLevel)(e.target.value)}>
            <option value="">All levels</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}-level
              </option>
            ))}
          </select>
          <select aria-label="SBC" className={cn(selectClassName, "w-auto")} value={sbc} onChange={(e) => filter(setSbc)(e.target.value)}>
            <option value="">Any SBC</option>
            {SBC.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {hasStatus && (
            <select aria-label="Status" className={cn(selectClassName, "w-auto")} value={status} onChange={(e) => filter(setStatus)(e.target.value)}>
              <option value="">Any status</option>
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {COURSE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
          {scheduleTerm && (
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={scheduledOnly}
                onChange={(e) => filter(setScheduledOnly)(e.target.checked)}
              />
              On the {formatTerm(scheduleTerm)} schedule
            </label>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {matches.length} {matches.length === 1 ? "course" : "courses"}
      </p>

      {matches.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No matches</p>
      ) : (
        <ul className="divide-y border-y">
          {matches.slice(0, shown).map((c) => (
            <li key={c.code}>
              <Link
                href={`/courses/${slugFor(c.code)}`}
                className="flex items-center gap-3 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <span className="w-18 shrink-0 font-mono text-xs">{c.code}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                <span className="hidden shrink-0 gap-1 md:flex">
                  {c.sbc.map((t) => (
                    <span key={t} className="rounded border px-1 text-[10px] text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </span>
                {c.status && <CourseStatusBadge status={c.status} className="hidden sm:inline-flex" />}
                {c.scheduled && scheduleTerm && (
                  <CalendarCheck className="size-4 shrink-0 text-muted-foreground" aria-label={`On the ${formatTerm(scheduleTerm)} schedule`} />
                )}
                <span className="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{c.credits} cr</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {matches.length > shown && (
        <Button variant="outline" className="w-full" onClick={() => setShown((n) => n + PAGE)}>
          Show more
        </Button>
      )}
    </div>
  );
}
