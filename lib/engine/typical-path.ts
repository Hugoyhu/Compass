/**
 * A major's typical path: the catalog's suggested sequence laid out in steps
 * from left to right, with interchangeable courses folded into one card and an
 * arrow only where a course directly builds on an earlier one.
 *
 * The sequence supplies the left-to-right order (its terms become the steps). Courses the catalog lists as
 * "not for credit with" each other (AMS 151, MAT 125, MAT 131) share a card.
 * An arrow runs from card A to card B when B's prerequisites name any course in
 * A and A is in an earlier step; an arrow that an intermediate card already
 * implies (A → X → B) is dropped.
 */
import type { CourseRecord, Prereq } from "@/lib/domain/catalog/course";
import type { ProgramDefinition, Rule } from "@/lib/domain/catalog/program";
import type { CourseCode } from "@/lib/domain/types";
import { formatPrereq, plannedCredits } from "./prerequisites";

/** Pools of this many courses or fewer are shown as alternatives; larger ones are elective lists. */
const MAX_POOL_COURSES = 8;

export interface PathCard {
  /** The sequence's own course for this slot. */
  code: CourseCode;
  title: string;
  credits: number;
  /** Courses that can stand in for it: the sequence's alternatives and the catalog's equivalents. */
  alsoCodes: CourseCode[];
  /** Catalog prerequisite text, spelled out. */
  prerequisites: string;
  /** Index of its step (column). */
  col: number;
  /** Row within the column. */
  row: number;
}

export interface PathColumn {
  /** Slots that aren't a specific course, e.g. "SBC ×2", "Elective". */
  other: string[];
}

export interface PathEdge {
  from: CourseCode;
  to: CourseCode;
  /** True when the earlier course is only one of several ways in. */
  alternative: boolean;
}

export interface TypicalPath {
  columns: PathColumn[];
  cards: PathCard[];
  edges: PathEdge[];
}

/** Courses an expression names, each marked as an alternative when it sits under an "or". */
function prerequisiteRefs(expr: Prereq | undefined, alternative = false): { code: CourseCode; alternative: boolean }[] {
  if (!expr) return [];
  if (expr.type === "course") return [{ code: expr.code, alternative }];
  if (expr.type === "and") return expr.of.flatMap((e) => prerequisiteRefs(e, alternative));
  if (expr.type === "or") return expr.of.flatMap((e) => prerequisiteRefs(e, true));
  return [];
}

type DraftCard = PathCard & { group: Set<CourseCode> };

/** Courses a rule names directly; short "pick one" pools count, long elective lists don't. */
function namedCourses(rule: Rule, into: Set<CourseCode>) {
  if (rule.type === "course") into.add(rule.code);
  else if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach((r) => namedCourses(r, into));
  else if (rule.type === "choose") {
    const pool = rule.from.courses ?? [];
    if (pool.length > 0 && pool.length <= MAX_POOL_COURSES) pool.forEach((c) => into.add(c));
  }
}

/**
 * Every pair of cards where the second's prerequisites name a course in the
 * first, with A → X → B shortcuts dropped. Only pairs `ok` accepts are kept.
 */
function linkCards(cards: DraftCard[], catalog: Map<CourseCode, CourseRecord>, ok: (from: DraftCard, to: DraftCard) => boolean): PathEdge[] {
  const links = new Map<string, PathEdge>();
  for (const to of cards) {
    const refs = prerequisiteRefs(catalog.get(to.code)?.prerequisites);
    for (const from of cards) {
      if (from === to || !ok(from, to)) continue;
      const hits = refs.filter((r) => from.group.has(r.code));
      if (hits.length === 0) continue;
      links.set(`${from.code}>${to.code}`, { from: from.code, to: to.code, alternative: hits.every((h) => h.alternative) });
    }
  }
  return [...links.values()].filter((e) => ![...links.values()].some((mid) => mid.from === e.from && mid.to !== e.to && links.has(`${mid.to}>${e.to}`)));
}

/** 1–4 for 100-level through 400-level courses. */
function levelOf(code: CourseCode): number {
  const number = Number(/\d+/.exec(code)?.[0] ?? 100);
  return Math.min(4, Math.max(1, Math.floor(number / 100)));
}

/**
 * For a program without a suggested sequence: its own courses in columns by
 * level (100s, 200s, 300s, 400s), pushed further right where a prerequisite
 * from the program needs the room, so a course never sits left of or beside
 * one it builds on. Levels no course uses get no column. Courses that don't
 * build on each other still get their level columns, just without arrows. Null
 * when the program names fewer than two courses outright.
 */
function pathFromPrerequisites(program: ProgramDefinition, catalog: Map<CourseCode, CourseRecord>): TypicalPath | null {
  const named = new Set<CourseCode>();
  program.requirements.forEach((r) => namedCourses(r.rule, named));
  // Courses the catalog says can't both be taken for credit (AMS 151, MAT 125, MAT 131) share one card.
  const parent = new Map<CourseCode, CourseCode>([...named].map((c) => [c, c]));
  const find = (c: CourseCode): CourseCode => (parent.get(c) === c ? c : find(parent.get(c)!));
  for (const code of named) {
    for (const other of catalog.get(code)?.equivalents ?? []) if (named.has(other)) parent.set(find(other), find(code));
  }
  const members = new Map<CourseCode, CourseCode[]>();
  for (const code of [...named].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
    members.set(find(code), [...(members.get(find(code)) ?? []), code]);
  }
  const cards: DraftCard[] = [...members.values()].map((group) => {
    // The card shows the course that lists the others as its equivalents.
    const code = [...group].sort((a, b) => (catalog.get(b)?.equivalents.length ?? 0) - (catalog.get(a)?.equivalents.length ?? 0))[0];
    const course = catalog.get(code);
    return {
      code,
      title: course?.title ?? "",
      credits: course ? plannedCredits(course) : 0,
      alsoCodes: group.filter((c) => c !== code),
      prerequisites: formatPrereq(course?.prerequisites),
      col: 0,
      row: 0,
      group: new Set(group),
    };
  });

  // Column = its level's column, or one past its furthest prerequisite; a link that closes a cycle is skipped.
  const levels = [...new Set(cards.map((c) => levelOf(c.code)))].sort((a, b) => a - b);
  const links = linkCards(cards, catalog, () => true);
  const needs = new Map<CourseCode, CourseCode[]>();
  for (const e of links) needs.set(e.to, [...(needs.get(e.to) ?? []), e.from]);
  const column = new Map<CourseCode, number>();
  const visiting = new Set<CourseCode>();
  const columnOf = (code: CourseCode): number => {
    if (column.has(code)) return column.get(code)!;
    visiting.add(code);
    const base = levels.indexOf(levelOf(code));
    const col = Math.max(base, ...(needs.get(code) ?? []).filter((c) => !visiting.has(c)).map((c) => columnOf(c) + 1));
    visiting.delete(code);
    column.set(code, col);
    return col;
  };
  cards.forEach((c) => (c.col = columnOf(c.code)));
  const edges = linkCards(cards, catalog, (from, to) => from.col < to.col);
  if (cards.length < 2) return null;

  const columns: PathColumn[] = Array.from({ length: Math.max(...cards.map((c) => c.col)) + 1 }, () => ({ other: [] }));
  const rows = new Map<number, number>();
  for (const c of cards) {
    c.row = rows.get(c.col) ?? 0;
    rows.set(c.col, c.row + 1);
  }
  return { columns, cards: cards.map(publicCard), edges };
}

function publicCard(c: DraftCard): PathCard {
  return { code: c.code, title: c.title, credits: c.credits, alsoCodes: c.alsoCodes, prerequisites: c.prerequisites, col: c.col, row: c.row };
}

/** The catalog's suggested sequence when the program has one, otherwise an ordering from prerequisites; null when neither gives a path. */
export function buildTypicalPath(program: ProgramDefinition, courses: CourseRecord[]): TypicalPath | null {
  const catalog = new Map(courses.map((c) => [c.code, c]));
  const sequence = program.sampleSequence;
  if (!sequence || sequence.length === 0) return pathFromPrerequisites(program, catalog);

  const inSequence = new Set<CourseCode>(
    sequence.flatMap((t) => t.slots.flatMap((slot) => (slot.kind === "course" ? [slot.code] : []))),
  );
  const columns: PathColumn[] = [];
  const cards: DraftCard[] = [];
  const seen = new Set<CourseCode>();
  sequence.forEach((term, col) => {
    const others = new Map<string, number>();
    let row = 0;
    for (const slot of term.slots) {
      if (slot.kind !== "course") {
        const label = slot.label.replace(/\s+\d+$/, "");
        others.set(label, (others.get(label) ?? 0) + 1);
        continue;
      }
      if (seen.has(slot.code)) continue;
      seen.add(slot.code);
      const course = catalog.get(slot.code);
      // A course the sequence lists on its own (CSE 114 after CSE 101) is a step, not a stand-in.
      const also = [...new Set([...(slot.alternatives ?? []), ...(course?.equivalents ?? [])])].filter((c) => c !== slot.code && !inSequence.has(c));
      cards.push({
        code: slot.code,
        title: course?.title ?? "",
        credits: course ? plannedCredits(course) : 0,
        alsoCodes: also,
        prerequisites: formatPrereq(course?.prerequisites),
        col,
        row: row++,
        group: new Set([slot.code, ...also]),
      });
    }
    columns.push({
      other: [...others].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)),
    });
  });

  const edges = linkCards(cards, catalog, (from, to) => from.col < to.col);
  return { columns, cards: cards.map(publicCard), edges };
}
