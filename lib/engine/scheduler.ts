/**
 * Puts the roadmap into semesters.
 *
 * Semesters the student already planned stay as they are; the scheduler fills
 * the empty fall and spring semesters of the degree (eight in all, the current
 * one included). Summer and winter are left alone.
 *
 * Each course, elective slot, and SBC placeholder is a unit. A unit's latest
 * term comes from what depends on it (CSE 495 before CSE 496, AMS 311 before
 * AMS 316) and the seasons it runs, counted back from the last semester. Term
 * by term, units that have run out of room go first, then the rest in order of
 * how soon they're due, with each program held to its share of the remaining
 * semesters so no one program fills a term. Free electives top terms up to an
 * even load. Units that can't fit spill into extra semesters, reported as such.
 */
import type { CourseRecord, Prereq } from "@/lib/domain/catalog/course";
import { nextRegularTerm, parseTerm, termOrdinal } from "@/lib/domain/terms";
import type { CourseCode, PlannedTerm, PlanItem, Season, TermId } from "@/lib/domain/types";
import { earliestYear, isSeniorCourse, MAX_TERM_CREDITS, semesterIndex, SENIOR_YEAR, yearStart, minTermCredits, placeholderCredits, SBC_PLACEHOLDER_CREDITS, type PlanContext } from "./plan";
import { pairedCorequisite, plannedCredits, usableAttempts } from "./prerequisites";
import { buildRoadmap, type Roadmap } from "./roadmap";
import { suggestedSemesters } from "./sample-schedule";
import { formatProgramName } from "@/lib/domain/program-name";

/** The most credits the scheduler puts in a semester, unless the goal needs more. */
export const SCHEDULED_MAX_CREDITS = 18;
/** Credits a term may run over its even share, so a lecture with its lab still fits. */
const LOAD_SLACK = 1;
const SLOT_CREDITS = 3;
const ELECTIVE_CREDITS = 3;
/** Semesters added past the degree's last one when units don't fit. */
const MAX_EXTRA_TERMS = 4;
const STANDING_CREDITS = { U2: 24, U3: 57, U4: 85 } as const;

interface Unit {
  key: string;
  items: PlanItem[];
  credits: number;
  /** The program whose pace the unit counts against; null for SBC placeholders. */
  programId: string | null;
  codes: CourseCode[];
  kind: "course" | "slot" | "sbc";
  seasons: Season[] | null;
  minYear: number;
  /** An upper-division elective slot, which waits for its program's lower-division courses. */
  upperDivision: boolean;
  label: string;
  /** Index into the degree's remaining semesters of the last one the unit can go in. */
  latest: number;
  /** Units that depend on it, transitively; longer chains go first among equals. */
  depth: number;
  /** The semester (as from semesterIndex) the primary major's suggested schedule puts it in; null when it doesn't. */
  suggested: number | null;
  /** The only semester (as from semesterIndex) a program says the unit may go in; null when any. */
  fixed: number | null;
}

export interface ScheduleResult {
  plan: PlannedTerm[];
  /** Semesters the scheduler filled, including any past the degree's last. */
  generated: TermId[];
  /** Semesters past the degree's last that units spilled into. */
  extraTerms: TermId[];
  /** Units that fit in no semester (a prerequisite the scheduler can't place). */
  unplaced: string[];
}

export function schedulePlan(ctx: PlanContext, roadmap: Roadmap = buildRoadmap(ctx)): ScheduleResult {
  const { student } = ctx;
  const catalog = new Map(ctx.courses.map((c) => [c.code, c]));
  const minCredits = minTermCredits(student);
  // A tight goal may use the most a student can take without approval (19).
  const maxCredits = Math.max(roadmap.terms.perTerm > SCHEDULED_MAX_CREDITS ? MAX_TERM_CREDITS : SCHEDULED_MAX_CREDITS, minCredits);

  const kept = student.plan.filter((t) => t.items.length > 0);
  const keptTerms = new Map(kept.map((t) => [t.term, t]));
  const remaining = roadmap.terms.remaining;
  const units = buildUnits(ctx, roadmap, catalog);
  // The primary major's suggested schedule: a course is held back until its suggested semester, and goes first once past it.
  const placements = new Map<CourseCode, number>();
  for (const p of ctx.programs) {
    if (student.programIds.includes(p.id)) for (const x of p.placements ?? []) placements.set(x.code, x.semester - 1);
  }
  for (const u of units) {
    const at = u.codes.flatMap((c) => (placements.has(c) ? [placements.get(c)!] : []));
    if (at.length > 0) u.fixed = Math.max(...at);
  }
  const suggested = suggestedSemesters(ctx.programs.filter((p) => student.programIds.includes(p.id)), student);
  for (const u of units) {
    const at = u.codes.flatMap((c) => (suggested.has(c) ? [suggested.get(c)!] : []));
    if (at.length > 0) u.suggested = Math.min(...at);
  }

  // When each course is (or will be) done: taken ones before everything; planned and placed ones in their term.
  const doneAt = new Map<CourseCode, number>();
  for (const a of usableAttempts(student.attempts)) doneAt.set(a.code, -Infinity);
  for (const code of [...doneAt.keys()]) for (const e of catalog.get(code)?.equivalents ?? []) if (!doneAt.has(e)) doneAt.set(e, -Infinity);
  for (const t of kept) for (const i of t.items) if ("code" in i) doneAt.set(i.code, termOrdinal(t.term));
  const pending = new Map<CourseCode, Unit>(units.flatMap((u) => u.codes.map((c) => [c, u] as const)));
  const sequels = sequenceEdges(catalog, [...pending.keys()]);

  computeLatest(units, pending, catalog, sequels, remaining, keptTerms);
  // A fixed semester still ahead is the unit's only one. Once it has passed, the unit just waits for its season.
  const ahead = (u: Unit) => u.fixed !== null && remaining.some((t) => semesterIndex(student, t) === u.fixed);
  for (const u of units) if (ahead(u)) u.latest = Math.min(u.latest, remaining.findIndex((t) => semesterIndex(student, t) === u.fixed));

  // Standing counts transfer credit but not AP, matching the roadmap.
  let standingCredits = roadmap.credits.done - apCredits(ctx, catalog);
  let freeLeft = roadmap.credits.free;
  const unplaced = new Set(units);
  const generated: TermId[] = [];
  const extraTerms: TermId[] = [];
  const plan: PlannedTerm[] = [];


  /** Prerequisites met by term `t`: "wait" while a needed course isn't placed before it. */
  const status = (e: Prereq | undefined, t: number, unit: Unit, standing: number): "ok" | "wait" | "blocked" => {
    if (!e) return "ok";
    switch (e.type) {
      case "course": {
        if (unit.codes.includes(e.code)) return "ok";
        const at = doneAt.get(e.code);
        if (at !== undefined) return at < t || (e.concurrentAllowed && at === t) ? "ok" : "wait";
        return pending.has(e.code) ? "wait" : "blocked";
      }
      case "standing":
        return standing >= STANDING_CREDITS[e.level] ? "ok" : "wait";
      case "and": {
        const parts = e.of.map((x) => status(x, t, unit, standing));
        return parts.includes("wait") ? "wait" : "ok";
      }
      case "or": {
        const parts = e.of.map((x) => status(x, t, unit, standing));
        return parts.includes("ok") ? "ok" : parts.includes("wait") ? "wait" : "ok";
      }
      default:
        return "ok";
    }
  };

  const ready = (unit: Unit, term: TermId, standing: number): boolean => {
    const t = termOrdinal(term);
    // "Senior" requirements wait for the degree's last two semesters, however many there are.
    if (semesterIndex(student, term) < yearStart(student, unit.minYear, unit.seasons)) return false;
    if (unit.seasons?.length && !unit.seasons.includes(parseTerm(term).season)) return false;
    if (ahead(unit) && semesterIndex(student, term) !== unit.fixed) return false;
    for (const code of unit.codes) {
      if (status(catalog.get(code)?.prerequisites, t, unit, standing) === "wait") return false;
      if ((sequels.get(code) ?? []).some((pre) => (doneAt.get(pre) ?? Infinity) >= t && !unit.codes.includes(pre))) return false;
    }
    if (unit.kind === "slot" && unit.upperDivision) {
      if (standing < STANDING_CREDITS.U2) return false;
      // Upper-division electives wait for the program's 100- and 200-level courses.
      const lower = [...unplaced].some((u) => u.kind === "course" && u.programId === unit.programId && u.codes.some((c) => level(c) < 3));
      if (lower) return false;
    }
    return true;
  };

  const fill = (term: TermId, index: number, termsLeft: number, extra: boolean): PlanItem[] => {
    const items: PlanItem[] = [];
    let credits = 0;
    const leftCredits = [...unplaced].reduce((s, u) => s + u.credits, 0) + freeLeft;
    const target = extra ? maxCredits : Math.min(maxCredits, Math.max(minCredits, Math.ceil(leftCredits / Math.max(1, termsLeft))));
    const placedFor = new Map<string, number>();
    const unitsOf = (id: string | null) => [...unplaced].filter((u) => u.programId === id).length;
    const cap = new Map<string | null, number>();
    const capFor = (id: string | null) => {
      if (!cap.has(id)) cap.set(id, Math.max(1, Math.ceil(unitsOf(id) / Math.max(1, termsLeft))));
      return cap.get(id)!;
    };

    const semester = semesterIndex(student, term);
    // Ahead of the major's suggested schedule: only used to reach the load, after everything on or behind it.
    const early = (u: Unit) => u.suggested !== null && semester < u.suggested;
    // Due: out of room, or the suggested schedule's semester has come, whatever the program's pace.
    const isDue = (u: Unit) => u.latest <= index || (u.suggested !== null && semester >= u.suggested);
    const candidates = [...unplaced]
      .filter((u) => ready(u, term, standingCredits))
      .sort((a, b) => {
        const due = (u: Unit) => (isDue(u) ? 0 : 1);
        const kind = { course: 0, slot: 1, sbc: 2 };
        return due(a) - due(b) || Number(early(a)) - Number(early(b)) || a.latest - b.latest || (a.suggested ?? 99) - (b.suggested ?? 99) || b.depth - a.depth || kind[a.kind] - kind[b.kind] || a.key.localeCompare(b.key);
      });
    const take = (u: Unit) => {
      items.push(...u.items);
      credits += u.credits;
      unplaced.delete(u);
      placedFor.set(String(u.programId), (placedFor.get(String(u.programId)) ?? 0) + 1);
      for (const c of u.codes) doneAt.set(c, termOrdinal(term));
    };

    // Due units first, whatever the program; then each program up to its pace; then anything ready, to the target.
    for (const pass of ["due", "paced", "any"] as const) {
      for (const u of candidates) {
        if (!unplaced.has(u) || credits + u.credits > maxCredits) continue;
        const due = isDue(u);
        if (pass === "due" && !due) continue;
        if (pass !== "due" && credits >= target) break;
        if (pass === "paced" && early(u)) continue;
        // Close to the even share, so the work spreads over every semester of the goal.
        if (pass !== "due" && credits + u.credits > Math.max(target, minCredits) + LOAD_SLACK) continue;
        if (pass === "paced" && (placedFor.get(String(u.programId)) ?? 0) >= capFor(u.programId)) continue;
        take(u);
      }
    }

    // Free electives even out the load; the last semester takes whatever's left of them.
    const last = !extra && termsLeft === 1;
    while (freeLeft > 0 && credits + ELECTIVE_CREDITS <= maxCredits && (credits < target || last)) {
      items.push({ elective: ELECTIVE_CREDITS });
      credits += ELECTIVE_CREDITS;
      freeLeft -= ELECTIVE_CREDITS;
    }
    // A full-time load even past the degree's credit total, unless nothing is left at all.
    while (credits < minCredits && credits + ELECTIVE_CREDITS <= maxCredits && (unplaced.size > 0 || !extra)) {
      items.push({ elective: ELECTIVE_CREDITS });
      credits += ELECTIVE_CREDITS;
    }
    return items;
  };

  const fillable = remaining.filter((t) => !keptTerms.has(t));
  // Every regular semester through the last planned or degree one, in order, so standing grows term by term.
  const lastTerm = [remaining.at(-1), ...kept.map((t) => t.term)].filter(Boolean).sort((a, b) => termOrdinal(a!) - termOrdinal(b!)).at(-1);
  const sequence: TermId[] = [...new Set([...remaining, ...kept.map((t) => t.term)])].sort((a, b) => termOrdinal(a) - termOrdinal(b));

  for (const term of sequence) {
    const keptTerm = keptTerms.get(term);
    if (keptTerm) {
      plan.push(keptTerm);
      standingCredits += keptTerm.items.reduce((s, i) => s + itemCredits(i, catalog), 0);
      continue;
    }
    const index = remaining.indexOf(term);
    const termsLeft = fillable.filter((t) => termOrdinal(t) >= termOrdinal(term)).length;
    const items = unplaced.size > 0 || freeLeft > 0 ? fill(term, index, termsLeft, false) : [];
    if (items.length === 0) continue;
    plan.push({ term, items });
    generated.push(term);
    standingCredits += items.reduce((s, i) => s + itemCredits(i, catalog), 0);
  }

  // Past the degree's last semester only while units remain and each new semester places some.
  let extra = nextRegularTerm(lastTerm ?? student.currentTerm);
  while (unplaced.size > 0 && extraTerms.length < MAX_EXTRA_TERMS) {
    while (keptTerms.has(extra)) extra = nextRegularTerm(extra);
    const before = unplaced.size;
    const items = fill(extra, remaining.length + extraTerms.length, 1, true);
    if (unplaced.size === before) break;
    plan.push({ term: extra, items });
    generated.push(extra);
    extraTerms.push(extra);
    standingCredits += items.reduce((s, i) => s + itemCredits(i, catalog), 0);
    extra = nextRegularTerm(extra);
  }

  plan.sort((a, b) => termOrdinal(a.term) - termOrdinal(b.term));
  return { plan, generated, extraTerms, unplaced: [...unplaced].map((u) => u.label) };
}

const level = (code: CourseCode) => Math.floor(Number(code.split(" ")[1]) / 100);

function itemCredits(item: PlanItem, catalog: Map<CourseCode, CourseRecord>): number {
  if ("code" in item) {
    const course = catalog.get(item.code);
    return course ? plannedCredits(course) : 3;
  }
  return placeholderCredits(item);
}

/** AP credit on the record, which raises credits but not class standing. */
function apCredits(ctx: PlanContext, catalog: Map<CourseCode, CourseRecord>): number {
  return usableAttempts(ctx.student.attempts)
    .filter((a) => a.source === "ap" && a.status === "completed")
    .reduce((s, a) => s + (a.credits ?? itemCredits({ code: a.code }, catalog)), 0);
}

/** The roadmap's needed courses (a lecture with its lab as one unit), elective slots, and SBC placeholders. */
function buildUnits(ctx: PlanContext, roadmap: Roadmap, catalog: Map<CourseCode, CourseRecord>): Unit[] {
  const units: Unit[] = [];
  const owner = new Map<CourseCode, string>();
  const minYear = new Map<CourseCode, number>();
  const needed = new Map<CourseCode, Roadmap["prerequisites"][number]>();
  for (const p of roadmap.programs) {
    for (const r of p.requirements) {
      const year = earliestYear(r.heading);
      for (const c of r.courses) {
        if (c.state !== "needed") continue;
        needed.set(c.code, c);
        if (!owner.has(c.code)) owner.set(c.code, p.id);
        minYear.set(c.code, Math.max(minYear.get(c.code) ?? 1, year));
      }
      r.slots.forEach((slot, i) => {
        const count = Math.ceil(Math.max(0, slot.credits - slot.absorbed) / SLOT_CREDITS);
        // Only as many slots as the other pools take ("at most 6 credits from non-AMS courses") count toward them too.
        const lending = Math.ceil(slot.lent / SLOT_CREDITS);
        for (let n = 0; n < count; n++) {
          units.push({
            key: `slot:${slot.requirementId}:${i}:${n}`,
            items: [{ slot: slot.requirementId, credits: SLOT_CREDITS, ...(n < lending && slot.also.length > 0 && { also: slot.also }) }],
            credits: SLOT_CREDITS,
            programId: p.id,
            codes: [],
            kind: "slot",
            seasons: null,
            minYear: year,
            upperDivision: slot.upperDivision,
            label: `${formatProgramName(p.name)}: ${r.heading}`,
            latest: Infinity,
            depth: 0,
            suggested: null,
            fixed: null,
          });
        }
      });
    }
  }
  for (const c of roadmap.prerequisites) if (c.state === "needed") needed.set(c.code, c);

  // A lab and its lecture go in the same semester.
  const grouped = new Set<CourseCode>();
  for (const [code, course] of needed) {
    if (grouped.has(code)) continue;
    const record = catalog.get(code);
    const pair = record && pairedCorequisite(record);
    const codes = pair && needed.has(pair) && !grouped.has(pair) ? [code, pair] : [code];
    codes.forEach((c) => grouped.add(c));
    const programId = codes.map((c) => owner.get(c)).find(Boolean) ?? roadmap.programs[0]?.id ?? null;
    units.push({
      key: `course:${codes.join("+")}`,
      items: codes.map((c) => ({ code: c })),
      credits: codes.reduce((s, c) => s + (catalog.get(c) ? plannedCredits(catalog.get(c)!) : 3), 0),
      programId,
      codes,
      kind: "course",
      seasons: course.seasons,
      minYear: Math.max(...codes.map((c) => (catalog.get(c) && isSeniorCourse(catalog.get(c)!) ? SENIOR_YEAR : (minYear.get(c) ?? 1)))),
      upperDivision: false,
      label: codes.join(" + "),
      latest: Infinity,
      depth: 0,
      suggested: null,
      fixed: null,
    });
  }

  for (const s of roadmap.sbc) {
    units.push({
      key: `sbc:${s.code}`,
      items: [{ sbc: s.code }],
      credits: SBC_PLACEHOLDER_CREDITS,
      programId: null,
      codes: [],
      kind: "sbc",
      seasons: null,
      minYear: 1,
      upperDivision: false,
      label: `SBC ${s.code}`,
      latest: Infinity,
      depth: 0,
      suggested: null,
      fixed: null,
    });
  }
  return units;
}

/**
 * Two-part courses the catalog doesn't link by prerequisite: "Senior Project I"
 * and "Senior Project II" in the same subject. The second waits for the first.
 */
function sequenceEdges(catalog: Map<CourseCode, CourseRecord>, codes: CourseCode[]): Map<CourseCode, CourseCode[]> {
  const edges = new Map<CourseCode, CourseCode[]>();
  const byTitle = new Map<string, CourseCode>();
  for (const code of codes) {
    const title = catalog.get(code)?.title;
    const m = title?.match(/^(.*\S)\s+I$/);
    if (m) byTitle.set(`${code.split(" ")[0]}|${m[1]}`, code);
  }
  for (const code of codes) {
    const m = catalog.get(code)?.title.match(/^(.*\S)\s+II$/);
    const first = m && byTitle.get(`${code.split(" ")[0]}|${m[1]}`);
    if (first) edges.set(code, [first]);
  }
  return edges;
}

/**
 * Each unit's latest semester (an index into `remaining`): one before the
 * earliest of what depends on it, in a season it runs. Planned courses in kept
 * semesters hold back what they need. Depth counts the chain below a unit.
 */
function computeLatest(
  units: Unit[],
  pending: Map<CourseCode, Unit>,
  catalog: Map<CourseCode, CourseRecord>,
  sequels: Map<CourseCode, CourseCode[]>,
  remaining: TermId[],
  keptTerms: Map<TermId, PlannedTerm>,
) {
  const last = remaining.length - 1;
  // Unit → the units and kept semesters that need it.
  const dependents = new Map<Unit, Set<Unit>>();
  const keptNeeds = new Map<Unit, number>();
  const refs = (e: Prereq | undefined): CourseCode[] =>
    !e ? [] : e.type === "course" ? [e.code] : e.type === "and" || e.type === "or" ? e.of.flatMap(refs) : [];
  for (const u of units) {
    for (const code of u.codes) {
      for (const pre of [...refs(catalog.get(code)?.prerequisites), ...(sequels.get(code) ?? [])]) {
        const p = pending.get(pre);
        if (p && p !== u) dependents.set(p, new Set([...(dependents.get(p) ?? []), u]));
      }
    }
  }
  for (const [term, t] of keptTerms) {
    const index = remaining.indexOf(term);
    if (index === -1) continue;
    for (const i of t.items) {
      if (!("code" in i)) continue;
      for (const pre of refs(catalog.get(i.code)?.prerequisites)) {
        const p = pending.get(pre);
        if (p) keptNeeds.set(p, Math.min(keptNeeds.get(p) ?? Infinity, index - 1));
      }
    }
  }

  const visiting = new Set<Unit>();
  const resolve = (u: Unit): void => {
    if (u.latest !== Infinity || visiting.has(u)) return;
    visiting.add(u);
    let latest = Math.min(last, keptNeeds.get(u) ?? Infinity);
    let depth = 0;
    for (const d of dependents.get(u) ?? []) {
      resolve(d);
      latest = Math.min(latest, d.latest - 1);
      depth = Math.max(depth, d.depth + 1);
    }
    while (latest >= 0 && u.seasons?.length && remaining[latest] && !u.seasons.includes(parseTerm(remaining[latest]).season)) latest--;
    u.latest = latest;
    u.depth = depth;
    visiting.delete(u);
  };
  units.forEach(resolve);
}
