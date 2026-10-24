"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, Plus, Search, X } from "lucide-react";
import { saveSchedule } from "@/app/actions/schedule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectClassName } from "@/components/record/options";
import { DAY_LABELS, formatDays, formatMinutes, formatRange } from "@/lib/domain/meeting-format";
import { formatTerm } from "@/lib/domain/terms";
import type { TermId } from "@/lib/domain/types";
import type { ScheduleCourse, ScheduleSection, ScheduleView } from "@/lib/services/schedule";
import { cn } from "@/lib/utils";

const HOUR_HEIGHT = 68;
const MAX_RESULTS = 100;

/** Course colors, as hues; each course keeps the same one wherever it appears. */
const HUES = [250, 160, 30, 330, 200, 100, 0, 280];
function hueFor(code: string): number {
  let hash = 0;
  for (const ch of code) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length];
}

function formatHour(hour: number): string {
  return `${hour % 12 || 12}${hour >= 12 ? "PM" : "AM"}`;
}

/** True when two sections are in class at the same time on some day. */
function conflicts(a: ScheduleSection, b: ScheduleSection): boolean {
  if (!a.days.length || !b.days.length) return false;
  if (a.to < b.from || b.to < a.from) return false;
  return a.days.some((d) => b.days.includes(d)) && a.start < b.end && b.start < a.end;
}

interface Entry {
  course: ScheduleCourse;
  section: ScheduleSection;
}

interface Block {
  key: string;
  credits: number;
  section: ScheduleSection;
  code: string;
  day: number;
}

function blocksFor({ course, section }: Entry): Block[] {
  return section.days.map((day) => ({ key: `${section.id}-${day}`, section, code: course.code, credits: course.credits, day }));
}

export function ScheduleBuilder({ view, initialSelected }: { view: ScheduleView; initialSelected: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);

  const sectionIndex = useMemo(() => {
    const index = new Map<string, { course: ScheduleCourse; section: ScheduleSection }>();
    for (const course of view.courses) for (const section of course.sections) index.set(section.id, { course, section });
    return index;
  }, [view.courses]);

  const [selected, setSelectedState] = useState(() => initialSelected.filter((id) => sectionIndex.has(id)));
  const [, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  const picked = selected.flatMap((id) => sectionIndex.get(id) ?? []);
  const hover = hovered ? sectionIndex.get(hovered) : undefined;
  const hoverIsPicked = hovered ? selected.includes(hovered) : false;

  // Saved to the cookie, and to the account when signed in.
  function setSelected(next: string[]) {
    setSelectedState(next);
    startTransition(async () => {
      const result = await saveSchedule(view.term, next);
      setSaveError(result.ok ? null : result.error);
    });
  }

  function toggle(id: string) {
    const entry = sectionIndex.get(id);
    if (!entry) return;
    if (selected.includes(id)) return setSelected(selected.filter((s) => s !== id));
    // One section per course component: picking another LEC replaces the current LEC.
    const rest = selected.filter((s) => {
      const other = sectionIndex.get(s);
      return !(other && other.course.code === entry.course.code && other.section.component === entry.section.component);
    });
    setSelected([...rest, id]);
  }

  const results = useMemo(() => {
    // "CSE160" and "CSE 160" are the same search.
    const words = query.toLowerCase().replace(/([a-z])(\d)/g, "$1 $2").split(/\s+/).filter(Boolean);
    const entries: Entry[] = view.courses.flatMap((course) => course.sections.map((section) => ({ course, section })));
    if (!words.length) return entries;
    return entries.filter(({ course, section }) => {
      const haystack = `${course.code} ${course.title} ${section.label} ${section.instructor}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [query, view.courses]);

  const hoverConflicts = hover && !hoverIsPicked
    ? picked.filter((p) => p.section.id !== hover.section.id && conflicts(p.section, hover.section))
    : [];

  const timed = [...picked.map((p) => p.section), ...(hover ? [hover.section] : [])].filter((s) => s.days.length);
  const firstHour = Math.min(8, ...timed.map((s) => Math.floor(s.start / 60)));
  const lastHour = Math.max(17, ...timed.map((s) => Math.ceil(s.end / 60)));
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);

  const pickedCourses = new Map(picked.map((p) => [p.course.code, p.course]));
  const credits = [...pickedCourses.values()].reduce((sum, c) => sum + c.credits, 0);
  const unscheduled = picked.filter((p) => !p.section.days.length);

  if (!view.term) return <p className="text-sm text-muted-foreground">No class schedules are loaded yet.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Schedule Builder</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground tabular-nums">
            {pickedCourses.size} {pickedCourses.size === 1 ? "course" : "courses"} · {credits} credits
          </span>
          <select
            aria-label="Term"
            className={cn(selectClassName, "h-8 w-auto")}
            value={view.term}
            onChange={(e) => router.replace(`${pathname}?term=${e.target.value}`)}
          >
            {view.terms.map((t: TermId) => (
              <option key={t} value={t}>
                {formatTerm(t)}
              </option>
            ))}
          </select>
          {saveError && (
            <span role="alert" className="text-sm text-destructive">
              {saveError}
            </span>
          )}
          {selected.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <aside className="flex min-h-0 flex-col gap-2 lg:h-[calc(100vh-10rem)]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search courses, titles, instructors"
              aria-label="Search sections"
              className="pl-8"
            />
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border p-2 max-lg:max-h-96" onMouseLeave={() => setHovered(null)}>
            {results.slice(0, MAX_RESULTS).map((entry) => (
              <SectionResult
                key={entry.section.id}
                entry={entry}
                isSelected={selected.includes(entry.section.id)}
                clashes={!selected.includes(entry.section.id) && picked.some((p) => p.section.id !== entry.section.id && conflicts(p.section, entry.section))}
                onHover={setHovered}
                onToggle={toggle}
              />
            ))}
            {results.length === 0 && <p className="p-2 text-sm text-muted-foreground">No matching sections.</p>}
            {results.length > MAX_RESULTS && (
              <p className="p-2 text-xs text-muted-foreground">
                Showing {MAX_RESULTS} of {results.length} sections. Search to narrow them down.
              </p>
            )}
          </div>
        </aside>

        <section className="min-w-0 space-y-3">
          <WeekGrid
            hours={hours}
            picked={picked}
            hover={hover && !hoverIsPicked ? hover : undefined}
            hoverConflicts={hoverConflicts.length > 0}
            onRemove={toggle}
          />
          {hover && !hover.section.days.length && (
            <p className="text-xs text-muted-foreground">This section has no set meeting time.</p>
          )}
          {hoverConflicts.length > 0 && (
            <p className="text-xs text-destructive">
              Conflicts with {[...new Set(hoverConflicts.map((c) => c.course.code))].join(", ")}
            </p>
          )}
          {unscheduled.length > 0 && (
            <div className="rounded-lg border p-3 text-sm">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">No set meeting time</p>
              <ul className="space-y-1">
                {unscheduled.map(({ course, section }) => (
                  <li key={section.id} className="flex items-center justify-between gap-2">
                    <span>
                      {course.code} · {section.label}
                    </span>
                    <button type="button" aria-label={`Remove ${course.code} ${section.label}`} onClick={() => toggle(section.id)}>
                      <X className="size-4 text-muted-foreground hover:text-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionResult({
  entry: { course, section },
  isSelected,
  clashes,
  onHover,
  onToggle,
}: {
  entry: Entry;
  isSelected: boolean;
  clashes: boolean;
  onHover: (id: string | null) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(section.id)}
      onMouseEnter={() => onHover(section.id)}
      onFocus={() => onHover(section.id)}
      onBlur={() => onHover(null)}
      aria-pressed={isSelected}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg border bg-card px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
        isSelected && "border-primary/40 bg-primary/10",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {course.code} · {section.label}
          <span className="text-xs font-normal text-muted-foreground"> · {course.credits} cr</span>
        </span>
        <span className="block truncate text-muted-foreground">{course.title}</span>
        <span className="block text-muted-foreground">
          {section.days.length ? `${formatDays(section.days)} ${formatRange(section)}` : "TBA"}
        </span>
        {section.instructor && section.instructor !== "TBA" && (
          <span className="block truncate text-muted-foreground">{section.instructor}</span>
        )}
        {section.room && section.room !== "TBA" && <span className="block truncate text-muted-foreground">{section.room}</span>}
        {clashes && <span className="text-destructive">Time conflict</span>}
      </span>
      {isSelected ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : <Plus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}

function WeekGrid({
  hours,
  picked,
  hover,
  hoverConflicts,
  onRemove,
}: {
  hours: number[];
  picked: Entry[];
  hover: Entry | undefined;
  hoverConflicts: boolean;
  onRemove: (id: string) => void;
}) {
  const top = hours[0] * 60;
  const place = (b: Block) => ({
    top: ((b.section.start - top) / 60) * HOUR_HEIGHT,
    height: ((b.section.end - b.section.start) / 60) * HOUR_HEIGHT,
  });

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="grid min-w-[36rem] grid-cols-[3.5rem_repeat(5,1fr)]">
        <div className="border-b" />
        {DAY_LABELS.map((d) => (
          <div key={d} className="border-b border-l py-1.5 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        <div className="relative" style={{ height: hours.length * HOUR_HEIGHT }}>
          {hours.map((h, i) => (
            <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: i * HOUR_HEIGHT, display: i === 0 ? "none" : undefined }}>
              {formatHour(h)}
            </span>
          ))}
        </div>
        {DAY_LABELS.map((d, day) => (
          <div key={d} className="relative border-l" style={{ height: hours.length * HOUR_HEIGHT }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute inset-x-0 border-t" style={{ top: i * HOUR_HEIGHT }} />
            ))}
            {picked
              .flatMap(blocksFor)
              .filter((b) => b.day === day)
              .map((b) => (
                <ClassBlock key={b.key} block={b} style={place(b)} title={picked.find((p) => p.section.id === b.section.id)?.course.title ?? ""} onRemove={onRemove} />
              ))}
            {hover &&
              blocksFor(hover)
                .filter((b) => b.day === day)
                .map((b) => (
                  <div
                    key={`hover-${b.key}`}
                    className={cn(
                      "pointer-events-none absolute inset-x-0.5 z-10 overflow-hidden rounded-md border-2 border-dashed px-1.5 py-1 text-[11px] leading-tight",
                      hoverConflicts ? "border-destructive bg-destructive/20 text-destructive" : "border-primary bg-primary/15 text-primary",
                    )}
                    style={place(b)}
                  >
                    <p className="font-medium">{b.code}</p>
                    <p>
                      {b.section.label} · {b.credits} cr
                    </p>
                    <p className="tabular-nums">{formatRange(b.section)}</p>
                    {b.section.room && b.section.room !== "TBA" && <p className="truncate">{b.section.room}</p>}
                    {b.section.instructor && b.section.instructor !== "TBA" && <p className="truncate">{b.section.instructor}</p>}
                  </div>
                ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ClassBlock({
  block,
  style,
  title,
  onRemove,
}: {
  block: Block;
  style: { top: number; height: number };
  title: string;
  onRemove: (id: string) => void;
}) {
  const hue = hueFor(block.code);
  const { section } = block;
  return (
    <div
      className="group absolute inset-x-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight"
      style={{
        ...style,
        background: `oklch(0.92 0.06 ${hue} / 0.9)`,
        borderColor: `oklch(0.65 0.14 ${hue})`,
        color: `oklch(0.3 0.08 ${hue})`,
      }}
      title={`${block.code} ${title}\n${section.label} · ${formatMinutes(section.start)}–${formatMinutes(section.end)}`}
    >
      <button
        type="button"
        aria-label={`Remove ${block.code} ${section.label}`}
        onClick={() => onRemove(section.id)}
        className="absolute top-0.5 right-0.5 hidden rounded p-0.5 hover:bg-black/10 group-hover:block focus-visible:block"
      >
        <X className="size-3" />
      </button>
      <p className="font-semibold">{block.code}</p>
      <p>
        {section.label} · {block.credits} cr
      </p>
      <p className="tabular-nums">{formatRange(section)}</p>
      {section.room && section.room !== "TBA" && <p className="truncate">{section.room}</p>}
      {section.instructor && section.instructor !== "TBA" && <p className="truncate">{section.instructor}</p>}
    </div>
  );
}
