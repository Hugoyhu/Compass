/**
 * Data for the Schedule Builder: every main-campus class section in a term,
 * grouped by course, with meeting times parsed into minutes so the client can
 * draw and compare them without re-parsing PeopleSoft strings.
 */
import { getRepository } from "@/lib/data/repository";
import type { Section } from "@/lib/domain/catalog/offering";
import { nextRegularTerm, parseTerm } from "@/lib/domain/terms";
import type { TermId } from "@/lib/domain/types";
import { readSchedule } from "@/lib/student/schedule";

/** Weekdays the grid shows; PeopleSoft writes them as two-letter codes ("MoWe"). */
export const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr"] as const;

/** A term counts as a full schedule when it has this share of the fullest term's sections. */
const COMPLETE_SCHEDULE_SHARE = 0.5;

export interface ScheduleSection {
  /** PeopleSoft class number, unique within a term. */
  id: string;
  /** e.g. "LEC 01" */
  label: string;
  component: string;
  /** Indexes into WEEKDAYS; empty when the section has no set meeting time. */
  days: number[];
  /** Minutes after midnight; 0 when there's no set time. */
  start: number;
  end: number;
  room: string;
  instructor: string;
  /** ISO dates, so half-term sections don't conflict with sections of the other half. */
  from: string;
  to: string;
}

export interface ScheduleCourse {
  code: string;
  title: string;
  credits: number;
  sections: ScheduleSection[];
}

function parseTime(text: string): number {
  const match = /^(\d{1,2}):(\d{2})(AM|PM)$/.exec(text);
  if (!match) return 0;
  const hour = Number(match[1]) % 12;
  return (hour + (match[3] === "PM" ? 12 : 0)) * 60 + Number(match[2]);
}

function parseDays(text: string): number[] {
  const days: number[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    const day = WEEKDAYS.indexOf(text.slice(i, i + 2) as (typeof WEEKDAYS)[number]);
    if (day >= 0) days.push(day);
  }
  return days;
}

function toScheduleSection(s: Section): ScheduleSection {
  const meeting = s.meetings[0];
  const start = meeting ? parseTime(meeting.start) : 0;
  const end = meeting ? parseTime(meeting.end) : 0;
  const timed = start > 0 && end > start;
  return {
    id: s.classNumber,
    label: `${s.component} ${s.section}`,
    component: s.component,
    days: timed && meeting ? parseDays(meeting.days) : [],
    start: timed ? start : 0,
    end: timed ? end : 0,
    room: meeting?.room.replace(/\s*WESTCAMPUS$/, "") ?? "",
    instructor: meeting?.instructor ?? "",
    from: meeting?.startDate ?? "",
    to: meeting?.endDate ?? "",
  };
}

export async function getScheduleView(requested?: string) {
  const repo = getRepository();
  const [courses, offeringTerms] = await Promise.all([repo.listCourses(), repo.listOfferingTerms()]);
  const byTerm = await Promise.all(
    offeringTerms.map(async (term) => ({ term, sections: (await repo.listSections(term)) ?? [] })),
  );
  // Sections with no set time are only worth showing when they could be a real class:
  // tutorials (independent study and similar) are almost all unscheduled.
  const usable = (s: Section) => s.campus === "main" && !(s.component === "TUT" && s.meetings.every((m) => m.days === "TBA"));
  const counts = byTerm.map((t) => ({ term: t.term, count: t.sections.filter(usable).length })).filter((t) => t.count > 0);
  const fullest = Math.max(0, ...counts.map((t) => t.count));
  const terms = counts.filter((t) => t.count >= fullest * COMPLETE_SCHEDULE_SHARE).map((t) => t.term);

  const term: TermId | undefined = terms.find((t) => t === requested) ?? terms.filter((t) => parseTerm(t).season !== "Summer").at(-1) ?? terms.at(-1);
  if (!term) return { terms, term: null, courses: [] as ScheduleCourse[] };

  const info = new Map(courses.map((c) => [c.code, c]));
  const grouped = new Map<string, ScheduleCourse>();
  for (const s of byTerm.find((t) => t.term === term)?.sections.filter(usable) ?? []) {
    let course = grouped.get(s.code);
    if (!course) {
      const record = info.get(s.code);
      course = { code: s.code, title: record?.title ?? "", credits: record?.credits.min ?? 0, sections: [] };
      grouped.set(s.code, course);
    }
    course.sections.push(toScheduleSection(s));
  }
  return { terms, term, courses: [...grouped.values()].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })) };
}

/**
 * The sections the student picked in the Schedule Builder for their next regular
 * term. `published` is false when the catalog has no schedule for that term yet.
 */
export async function getNextSemesterSchedule(currentTerm: TermId) {
  const term = nextRegularTerm(currentTerm);
  const repo = getRepository();
  const [sections, courses, picked] = await Promise.all([repo.listSections(term), repo.listCourses(), readSchedule(term)]);
  if (!sections) return { term, published: false, courses: [] as ScheduleCourse[], credits: 0 };

  const info = new Map(courses.map((c) => [c.code, c]));
  const pickedIds = new Set(picked);
  const grouped = new Map<string, ScheduleCourse>();
  for (const s of sections) {
    if (!pickedIds.has(s.classNumber)) continue;
    let course = grouped.get(s.code);
    if (!course) {
      const record = info.get(s.code);
      course = { code: s.code, title: record?.title ?? "", credits: record?.credits.min ?? 0, sections: [] };
      grouped.set(s.code, course);
    }
    course.sections.push(toScheduleSection(s));
  }
  const list = [...grouped.values()].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  return { term, published: true, courses: list, credits: list.reduce((sum, c) => sum + c.credits, 0) };
}

export type NextSemesterSchedule = Awaited<ReturnType<typeof getNextSemesterSchedule>>;

export type ScheduleView = Awaited<ReturnType<typeof getScheduleView>>;
