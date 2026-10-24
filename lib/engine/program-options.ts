/**
 * Every course that could count toward a program's "pick N" requirements,
 * one lane per requirement, each course tagged with its level so the view can
 * lay them out 100s to 400s. Requirements that name their courses outright are
 * left to the typical path; this covers the open choices.
 */
import type { CourseRecord } from "@/lib/domain/catalog/course";
import type { ProgramDefinition, Rule } from "@/lib/domain/catalog/program";
import type { CourseCode, Season } from "@/lib/domain/types";
import { matchesSelector } from "./audit";
import { describeSelector } from "./describe";
import { foldEquivalents } from "./equivalents";
import { formatPrereq, plannedCredits, referencedCourses } from "./prerequisites";

/** A pool bigger than this (e.g. "any 300-level course") is described instead of listed. */
const MAX_LANE_COURSES = 150;

export interface OptionCard {
  code: CourseCode;
  title: string;
  credits: number;
  /** Interchangeable courses folded into this card. */
  alsoCodes: CourseCode[];
  /** 1–4 for 100-level through 400-level. */
  level: number;
  /** Fall and spring seasons it's known to run in; null when unknown. */
  seasons: Season[] | null;
  prerequisites: string;
  /** Other courses in this program's options that it builds on. */
  needs: CourseCode[];
  /** Other courses in this program's options that build on it. */
  leadsTo: CourseCode[];
}

export interface OptionLane {
  id: string;
  /** The requirement's title, or "Pick 2 courses" for a lane inside a concentration (its name is `group`). */
  title: string;
  /** The concentration, specialization, or track the lane belongs to; null for an ordinary requirement. */
  group: { kind: string; label: string } | null;
  /** The requirement the lane comes from. */
  requirement: string;
  /** "Pick 3 courses", "Pick 9 credits" */
  pick: string;
  /** The pool in words, for lanes too big to list. */
  description: string;
  /** Null when the pool is too big to list. */
  cards: OptionCard[] | null;
  /** Courses in the pool, before folding. */
  total: number;
}

export interface ProgramOptions {
  lanes: OptionLane[];
}

/** The concentration, specialization, or track a pick rule belongs to, when it sits inside one. */
interface Branch {
  kind: string;
  label: string;
}

interface FoundChoose {
  rule: Extract<Rule, { type: "choose" }>;
  branch: Branch | null;
}

function chooseRules(rule: Rule, branch: Branch | null = null, into: FoundChoose[] = []) {
  if (rule.type === "choose") into.push({ rule, branch });
  else if (rule.type === "allOf") rule.rules.forEach((r) => chooseRules(r, branch, into));
  else if (rule.type === "anyOf") {
    // Each alternative of a concentration is named; its pick rules belong to that name.
    rule.rules.forEach((alt) => chooseRules(alt, rule.choice && alt.label ? { kind: rule.choice, label: alt.label } : branch, into));
  }
  return into;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function levelOf(code: CourseCode): number {
  return Math.min(4, Math.max(1, Math.floor(Number(/\d+/.exec(code)?.[0] ?? 100) / 100)));
}

function pickText(rule: { count?: number; credits?: number }): string {
  if (rule.credits !== undefined) return `Pick ${rule.credits} credits`;
  if (rule.count !== undefined) return `Pick ${rule.count} ${rule.count === 1 ? "course" : "courses"}`;
  return "Pick any";
}

/** Null when no requirement of the program has a pool to list. */
export function buildProgramOptions(program: ProgramDefinition, courses: CourseRecord[]): ProgramOptions | null {
  const catalog = new Map(courses.map((c) => [c.code, c]));
  const lanes: OptionLane[] = [];
  const cardsByCode = new Map<CourseCode, OptionCard>();

  for (const requirement of program.requirements) {
    const rules = chooseRules(requirement.rule);
    rules.forEach(({ rule, branch }, i) => {
      const pool = courses.filter((c) => matchesSelector(c.code, c, rule.from)).map((c) => c.code);
      if (pool.length === 0) return;
      const requirementTitle = requirement.title ?? requirement.label;
      // A pick rule inside a concentration is grouped under the concentration's own name.
      const base = {
        id: `${requirement.id}.${i}`,
        title: branch ? pickText(rule) : requirementTitle + (rules.length > 1 ? ` (${i + 1})` : ""),
        group: branch ? { kind: capitalize(branch.kind), label: branch.label } : null,
        requirement: requirementTitle,
        pick: pickText(rule),
        description: describeSelector(rule.from),
        total: pool.length,
      };
      if (pool.length > MAX_LANE_COURSES) {
        lanes.push({ ...base, cards: null });
        return;
      }
      const cards = foldEquivalents(pool, catalog).map(({ code, members }): OptionCard => {
        const course = catalog.get(code)!;
        const seasons = course.typicallyOffered?.filter((s): s is "Fall" | "Spring" => s === "Fall" || s === "Spring");
        const card: OptionCard = {
          code,
          title: course.title,
          credits: plannedCredits(course),
          alsoCodes: members.filter((c) => c !== code),
          level: levelOf(code),
          seasons: seasons?.length ? seasons : null,
          prerequisites: formatPrereq(course.prerequisites),
          needs: [],
          leadsTo: [],
        };
        // The same course can serve two requirements; keep one record so links agree.
        return cardsByCode.get(code) ?? (cardsByCode.set(code, card), card);
      });
      lanes.push({ ...base, cards: cards.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })) });
    });
  }
  if (lanes.length === 0) return null;

  // Direct prerequisite links between courses that appear in the options.
  const owner = new Map<CourseCode, OptionCard>();
  for (const card of cardsByCode.values()) for (const c of [card.code, ...card.alsoCodes]) owner.set(c, card);
  for (const card of cardsByCode.values()) {
    for (const ref of new Set(referencedCourses(catalog.get(card.code)?.prerequisites))) {
      const other = owner.get(ref);
      if (!other || other === card) continue;
      if (!card.needs.includes(other.code)) card.needs.push(other.code);
      if (!other.leadsTo.includes(card.code)) other.leadsTo.push(card.code);
    }
  }
  return { lanes };
}
