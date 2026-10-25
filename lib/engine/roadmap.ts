/**
 * The road to graduation: everything the student still needs, reduced to the
 * bare minimum, before anything is put in a semester.
 *
 * Each program's open requirements become specific courses (where the catalog
 * names them; of alternatives, the cheapest) and elective slots (what's left of
 * each "choose" pool once every specific course counts). Missing prerequisites
 * of those courses are added, and the audit is rerun until nothing changes, so
 * a course one program requires counts toward another's pool before a slot is
 * made for it. Open SBCs and the credits still short of the degree come last.
 *
 * Planned courses are kept as they are. Nothing here is scheduled; `earliest`
 * only says how soon prerequisite chains and season offerings allow a course.
 */
import type { CourseRecord, Prereq } from "@/lib/domain/catalog/course";
import type { ProgramDefinition, Rule } from "@/lib/domain/catalog/program";
import { nextRegularTerm, parseTerm, termOrdinal } from "@/lib/domain/terms";
import type { CourseCode, PlannedTerm, SbcCode, Season, TermId } from "@/lib/domain/types";
import { mandatoryCourses, matchesSelector, pickedCourses, preferredCourses, poolRoom, requiredByOthers, runDegreeAudit, type DegreeAudit, type MissingItem, type RequirementStatus } from "./audit";
import { describeSelector, isUpperDivisionPool, requirementHeading } from "./describe";
import { degreeTerms, earliestYear, isSeniorCourse, SENIOR_YEAR, yearStart, placeholderCredits, sbcToPlace, slotCredits, SBC_PLACEHOLDER_CREDITS, withPlan, type PlanContext } from "./plan";
import { replacedByOtherPrograms } from "./planner";
import { plannedCredits, usableAttempts } from "./prerequisites";
import { formatProgramName } from "@/lib/domain/program-name";

const SLOT_CREDITS = 3;
/** Pools this short are listed course by course. */
const MAX_LISTED = 10;
/** Rounds of "add what's missing, audit again"; real programs settle in two or three. */
const MAX_ROUNDS = 8;
/** Where courses the roadmap adds are put for the audit; any term after the plan works. */
const SOMEDAY: TermId = "2099-FA";

export type RoadmapCourseState = "done" | "in-progress" | "planned" | "needed";

export interface RoadmapCourse {
  code: CourseCode;
  title: string;
  credits: number;
  state: RoadmapCourseState;
  /** The planned term, for a planned course. */
  term?: TermId;
  /** Why it's needed when no requirement names it: "Prerequisite for CSE 300". */
  reason?: string;
  /** Seasons it runs in, from the latest complete schedules; null when unknown. */
  seasons: Season[] | null;
  /** The soonest regular term prerequisites and offerings allow, for a needed course. */
  earliest?: TermId;
}

export interface RoadmapSlot {
  programId: string;
  requirementId: string;
  /** "3 more courses" or "9 more credits". */
  remaining: number;
  unit: "courses" | "credits";
  /** Courses the slot stands for, at three credits each for a credit pool. */
  count: number;
  credits: number;
  /** "upper-division AMS courses or CSE 302–999". */
  pool: string;
  upperDivision: boolean;
  /** The concentration the pool belongs to, declared or the closest one. */
  option?: Extract<MissingItem, { kind: "choose" }>["option"];
  /** The pool's courses, when it's a short list rather than a range. */
  options?: CourseCode[];
  /** Other programs whose elective pools take some of the same courses, so one course can count for both. */
  sharesWith: string[];
  /** Requirements whose pools these slots' courses also fill, so they need no slots of their own for it. */
  also: string[];
  /** Credits of this slot that another program's slots cover (see `also`); only the rest need placing. */
  absorbed: number;
  /** Credits of this slot that also count toward the `also` requirements; the rest count here only. */
  lent: number;
}

/** One way to meet part of a requirement: a set of courses, among alternatives the student may switch between. */
export interface RoadmapAlternative {
  courses: { code: CourseCode; title: string; credits: number }[];
  current: boolean;
  /** Some of its courses are in the plan, which a switch away from it takes them out of. */
  planned: boolean;
}

/** A course the roadmap plans for a "choose from a short list" requirement, and the others that could take its place. */
export interface RoadmapSeat {
  selected: RoadmapSeatCourse;
  options: RoadmapSeatCourse[];
  /** The selected course is in the plan, which a swap takes it out of. */
  planned: boolean;
}

export interface RoadmapSeatCourse {
  code: CourseCode;
  title: string;
  credits: number;
  sbc: SbcCode[];
}

export interface RoadmapRequirement {
  id: string;
  heading: string;
  /** Where it stands on the record alone, before planned and needed courses. */
  status: RequirementStatus;
  courses: RoadmapCourse[];
  slots: RoadmapSlot[];
  /** Items only an advisor can settle. */
  review: string[];
  /** Alternatives the student can switch between (AMS or MAT calculus), when nothing from any of them is taken or planned yet. */
  alternatives: RoadmapAlternative[][];
  /** Credits of elective placeholders the plan already holds for it. */
  plannedSlotCredits: number;
  /** Elective slots the plan already covers in full. */
  coveredSlots: RoadmapSlot[];
  /** Courses planned for a choose-from-a-list rule, each swappable for another on the list. */
  seats: RoadmapSeat[];
}

export interface RoadmapProgram {
  id: string;
  name: string;
  kind: ProgramDefinition["kind"];
  /** Requirements the record alone doesn't meet; finished ones are counted in `done`. */
  requirements: RoadmapRequirement[];
  done: number;
  total: number;
  /** Credits of planned and needed courses and slots still ahead, counting a shared course for the first program only. */
  creditsLeft: number;
}

export interface Roadmap {
  programs: RoadmapProgram[];
  /** Needed courses no requirement names: prerequisites on the way to ones that are. */
  prerequisites: RoadmapCourse[];
  sbc: { code: SbcCode; name: string }[];
  credits: {
    required: number;
    /** Earned and in progress now. */
    done: number;
    planned: number;
    needed: number;
    /** Elective slot credits, less those one course can count toward two programs. */
    slots: number;
    /** Slot credits that can double-count across programs' pools. */
    shared: number;
    sbc: number;
    /** Free electives still needed to reach the degree total. */
    free: number;
  };
  upperDivision: { required: number; covered: number; short: number };
  terms: {
    /** Fall and spring semesters the degree aims for, the current one included. */
    total: number;
    /** Semesters taken or in progress. */
    used: number;
    remaining: TermId[];
    /** Credits per remaining semester to finish on time. */
    perTerm: number;
  };
  /** Needed courses whose prerequisite chain or season can't finish by the last semester. */
  late: { code: CourseCode; earliest: TermId; chain: CourseCode[] }[];
}

/** Seasons a course is known to run in, or null without complete schedules for both regular seasons. */
function seasonsOf(ctx: PlanContext, code: CourseCode): Season[] | null {
  const { Fall, Spring } = ctx.offeredBySeason;
  if (!Fall || !Spring) return null;
  return (["Fall", "Spring"] as const).filter((s) => ctx.offeredBySeason[s]!.has(code));
}

export function buildRoadmap(ctx: PlanContext): Roadmap {
  const { student } = ctx;
  const catalog = new Map(ctx.courses.map((c) => [c.code, c]));
  const sbcNames = new Map(ctx.sbcCategories.map((c) => [c.code, c.name]));
  const credits = (code: CourseCode) => {
    const course = catalog.get(code);
    return course ? plannedCredits(course) : SLOT_CREDITS;
  };

  const plan = student.plan;
  const plannedTerm = new Map<CourseCode, TermId>();
  for (const t of plan) for (const i of t.items) if ("code" in i) plannedTerm.set(i.code, t.term);
  const taken = new Map<CourseCode, "done" | "in-progress">();
  for (const a of usableAttempts(student.attempts)) {
    if (taken.get(a.code) !== "done") taken.set(a.code, a.status === "completed" ? "done" : "in-progress");
  }

  // Needed courses, in the order they were added, with why when no requirement names them.
  const needed = new Map<CourseCode, string | undefined>();
  const auditWith = (): DegreeAudit => {
    const extra: PlannedTerm[] = needed.size ? [{ term: SOMEDAY, items: [...needed.keys()].map((code) => ({ code })) }] : [];
    return runDegreeAudit({ ...ctx, student: withPlan(student, [...plan, ...extra]) });
  };
  // Equivalence may be recorded on either course.
  const equivalents = new Map<CourseCode, CourseCode[]>();
  for (const c of ctx.courses) {
    for (const e of c.equivalents) {
      equivalents.set(c.code, [...(equivalents.get(c.code) ?? []), e]);
      equivalents.set(e, [...(equivalents.get(e) ?? []), c.code]);
    }
  }
  /** Taken, in progress, planned or needed, directly or through an equivalent course. */
  const onHand = (code: CourseCode): boolean => {
    const has = (c: CourseCode) => taken.has(c) || plannedTerm.has(c) || needed.has(c);
    return has(code) || (equivalents.get(code) ?? []).some(has);
  };

  /** Prerequisite courses not on hand, for picking the cheapest of alternatives. */
  const missingPrereqs = (code: CourseCode, depth = 0): number => {
    if (depth > 3) return 0;
    const walk = (e: Prereq | undefined): number => {
      if (!e) return 0;
      if (e.type === "course") return onHand(e.code) ? 0 : 1 + missingPrereqs(e.code, depth + 1);
      if (e.type === "and") return e.of.reduce((s, x) => s + walk(x), 0);
      if (e.type === "or") return Math.min(...e.of.map(walk));
      return 0;
    };
    return walk(catalog.get(code)?.prerequisites);
  };
  const cheapest = (options: CourseCode[], preferred: Set<CourseCode>): CourseCode | undefined => {
    const score = (c: CourseCode) => {
      const seasons = seasonsOf(ctx, c);
      return [
        preferred.has(c) ? 0 : 1,
        catalog.has(c) ? 0 : 1,
        missingPrereqs(c),
        seasons && seasons.length < 2 ? 1 : 0,
        Number(c.split(" ")[1]) || 0,
      ];
    };
    return [...options].sort((a, b) => {
      const [x, y] = [score(a), score(b)];
      return x.reduce((d, v, i) => d || v - y[i], 0);
    })[0];
  };

  /** Adds the missing prerequisites of a course, one option of each "or", until the chain reaches what's on hand. */
  const addPrerequisites = (code: CourseCode, replaced: Set<CourseCode>, preferred: Set<CourseCode>, depth = 0) => {
    if (depth > 4) return;
    const walk = (e: Prereq | undefined) => {
      if (!e) return;
      if (e.type === "course") {
        if (onHand(e.code) || replaced.has(e.code) || !catalog.has(e.code)) return;
        needed.set(e.code, `Prerequisite for ${code}`);
        addPrerequisites(e.code, replaced, preferred, depth + 1);
      } else if (e.type === "and") {
        e.of.forEach(walk);
      } else if (e.type === "or") {
        if (e.of.some((x) => x.type !== "course" || onHand(x.code))) return;
        const pick = cheapest(
          e.of.flatMap((x) => (x.type === "course" && !replaced.has(x.code) ? [x.code] : [])),
          preferred,
        );
        if (pick) walk({ type: "course", code: pick });
      }
    };
    walk(catalog.get(code)?.prerequisites);
  };

  const avoided = pickedCourses(student.choices, "avoid");
  // Courses a program assumes: planned up front, so they count toward its choices and their SBCs before anything else is picked.
  for (const p of ctx.programs) {
    if (!student.programIds.includes(p.id)) continue;
    for (const code of p.assumedCourses ?? []) {
      if (catalog.has(code) && !onHand(code) && !avoided.has(code)) needed.set(code, `Assumed with ${formatProgramName(p.name)}`);
    }
  }
  for (const code of pickedCourses(student.choices, "pick")) {
    if (catalog.has(code) && !onHand(code)) needed.set(code, "Your pick");
  }

  const studentPrefs = preferredCourses(student.choices);
  let result = auditWith();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const before = needed.size;
    const replaced = replacedByOtherPrograms(result);
    const enrolled = result.programs.map((p) => p.program);
    for (const p of result.programs) {
      const elsewhere = requiredByOthers(p.program, enrolled);
      for (const r of p.requirements) {
        for (const item of r.missing) {
          if (item.kind !== "course" || item.options.some(onHand)) continue;
          const open = item.options.filter((c) => !replaced.has(c));
          const pick = cheapest(open.length ? open : item.options, new Set([...elsewhere, ...studentPrefs]));
          if (pick) needed.set(pick, undefined);
        }
      }
    }
    // Of a prerequisite's alternatives, prefer one a program requires anyway.
    const preferred = new Set(enrolled.flatMap((p) => p.requirements.flatMap((r) => mandatoryCourses(r.rule))));
    for (const code of [...needed.keys()]) addPrerequisites(code, replaced, preferred);
    for (const code of plannedTerm.keys()) addPrerequisites(code, replaced, preferred);
    result = auditWith();
    if (needed.size === before) break;
  }

  // Bare minimum: a course added early can turn out unnecessary once later ones count (HON 495/496 when CSE 495/496
  // fill the Honors College senior project). Drop each one whose absence leaves every requirement and SBC as covered,
  // along with prerequisites only it needed.
  // Each requirement's progress (as a share, since alternatives count in different units) and the SBCs covered.
  const coverage = (a: DegreeAudit) => [
    ...a.programs.flatMap((p) => p.requirements).map((r) => (r.required ? Math.min(1, (r.completed + r.inProgress) / r.required) : 1)),
    a.sbc.results.filter((r) => ["satisfied", "in-progress", "exempt", "not-required"].includes(r.status)).length,
  ];
  const covers = (trial: number[], base: number[]) => base.every((v, i) => trial[i] >= v - 1e-9);
  const full = coverage(result);
  for (const code of [...needed.keys()].reverse()) {
    if (!needed.has(code) || needed.get(code)) continue;
    const removed = new Map<CourseCode, string | undefined>([[code, undefined]]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [c, why] of needed) {
        const target = why?.replace(/^Prerequisite for /, "");
        if (why && !removed.has(c) && target && removed.has(target)) {
          removed.set(c, why);
          grew = true;
        }
      }
    }
    const snapshot = [...needed];
    removed.forEach((_, c) => needed.delete(c));
    const trial = auditWith();
    if (covers(coverage(trial), full)) {
      result = trial;
    } else {
      needed.clear();
      snapshot.forEach(([c, why]) => needed.set(c, why));
    }
  }

  // What each course is and where it stands.
  const describe = (code: CourseCode): RoadmapCourse => {
    const state: RoadmapCourseState = plannedTerm.has(code) ? "planned" : (taken.get(code) ?? "needed");
    return {
      code,
      title: catalog.get(code)?.title ?? "",
      credits: credits(code),
      state,
      ...(state === "planned" && { term: plannedTerm.get(code) }),
      ...(state === "needed" && needed.get(code) && { reason: needed.get(code) }),
      seasons: seasonsOf(ctx, code),
    };
  };

  // Requirements are listed by where they stand on the record alone, so ones the plan covers still show.
  const recordOnly = runDegreeAudit({ ...ctx, student: { ...student, plan: [] } });
  const baseStatus = new Map(recordOnly.programs.flatMap((p) => p.requirements.map((r) => [r.requirement.id, r.status])));
  const listed = (r: DegreeAudit["programs"][number]["requirements"][number]) =>
    !["satisfied", "in-progress"].includes(baseStatus.get(r.requirement.id) ?? r.status);

  // Elective slots, less slots the plan already has for them.
  const slotsInPlan = slotCredits(plan);
  const plannedSlots = new Map(slotsInPlan);
  /** Slots the plan already covers in full, by requirement, so the roadmap can still say what they are. */
  const coveredSlots = new Map<string, RoadmapSlot[]>();
  const slotItems = result.programs.flatMap((p) =>
    p.requirements.filter(listed).flatMap((r) =>
      r.missing.flatMap((m) => {
        if (m.kind !== "choose") return [];
        const slot = slotFor(m, p.program.id, r.requirement.id);
        const planned = Math.min(plannedSlots.get(r.requirement.id) ?? 0, slot.credits);
        plannedSlots.set(r.requirement.id, (plannedSlots.get(r.requirement.id) ?? 0) - planned);
        if (planned >= slot.credits) {
          coveredSlots.set(r.requirement.id, [...(coveredSlots.get(r.requirement.id) ?? []), slot]);
          return [];
        }
        const credits = slot.credits - planned;
        const count = Math.ceil(credits / SLOT_CREDITS);
        return [{ programName: formatProgramName(p.program.name), item: m, applied: r.applied, slot: { ...slot, credits, count, remaining: m.unit === "credits" ? credits : count } }];
      }),
    ),
  );
  // One course can count toward two programs' pools at once (an upper-division CSE course for both the CS and AMS
  // electives). The narrower pool's slots stand in for the wider one's, up to their credits and any limit on how
  // much of a pool such courses may fill ("at most 6 credits from non-AMS courses").
  const poolCourses = slotItems.map(({ item, applied }) =>
    new Set(
      ctx.courses
        .filter(
          (c) =>
            Number(c.code.split(" ")[1]) < 500 &&
            !item.exclude.includes(c.code) &&
            !onHand(c.code) &&
            matchesSelector(c.code, c, item.pool) &&
            poolRoom(item, applied, catalog, c.code) > 0,
        )
        .map((c) => c.code),
    ),
  );
  const spare = slotItems.map(({ slot }) => slot.credits);
  let sharedCredits = 0;
  slotItems.forEach((a, i) =>
    slotItems.forEach((b, j) => {
      const overlap = [...poolCourses[i]].filter((c) => poolCourses[j].has(c));
      if (j <= i || a.slot.programId === b.slot.programId || overlap.length === 0) return;
      a.slot.sharesWith.push(b.programName);
      b.slot.sharesWith.push(a.programName);
      const room = (x: (typeof slotItems)[number]) => Math.max(...overlap.map((c) => poolRoom(x.item, x.applied, catalog, c)));
      const both = Math.min(spare[i], spare[j], room(a), room(b));
      if (both <= 0) return;
      const [keep, wide] = poolCourses[i].size <= poolCourses[j].size ? [a, b] : [b, a];
      keep.slot.also.push(wide.slot.requirementId);
      keep.slot.lent += both;
      wide.slot.absorbed += both;
      spare[i] -= both;
      spare[j] -= both;
      sharedCredits += both;
    }),
  );

  // SBCs no planned or needed course covers, less those the plan already has placeholders for.
  const placeholders = new Set(plan.flatMap((t) => t.items.flatMap((i) => ("sbc" in i ? [i.sbc] : []))));
  const sbc = sbcToPlace(result)
    .filter((code) => !placeholders.has(code))
    .map((code) => ({ code, name: sbcNames.get(code) ?? code }));

  const slotTotal = slotItems.reduce((s, x) => s + x.slot.credits, 0) - sharedCredits;
  const planPlaceholders = plan.flatMap((t) => t.items).reduce((s, i) => s + placeholderCredits(i), 0);
  const plannedCourseCredits = [...plannedTerm.keys()].reduce((s, c) => s + credits(c), 0);
  const neededCredits = [...needed.keys()].reduce((s, c) => s + credits(c), 0);
  const done = result.credits.earned + result.credits.inProgress - plannedCourseCredits - neededCredits;
  const sbcCredits = sbc.length * SBC_PLACEHOLDER_CREDITS;
  const free = Math.max(
    0,
    result.credits.required - done - plannedCourseCredits - planPlaceholders - neededCredits - slotTotal - sbcCredits,
  );
  const ud = result.credits.upperDivision;
  const udCovered = ud.earned + ud.inProgress + slotItems.filter((s) => s.slot.upperDivision).reduce((s, x) => s + x.slot.credits, 0);
  const left = plannedCourseCredits + planPlaceholders + neededCredits + slotTotal + sbcCredits + free;

  // Semesters: the degree's fall and spring terms from entry, those up to the current one used.
  const allTerms = degreeTerms(student);
  const remaining = allTerms.filter((t) => termOrdinal(t) > termOrdinal(student.currentTerm));
  const perTerm = remaining.length ? Math.ceil(left / remaining.length) : left;

  // "Second- and third-year Honors courses" can't start before year 2; a course takes the latest year of its requirements.
  const minYear = new Map<CourseCode, number>();
  for (const p of result.programs) {
    for (const r of p.requirements) {
      const year = earliestYear(r.requirement.title);
      for (const a of r.applied) if (year > (minYear.get(a.code) ?? 1)) minYear.set(a.code, year);
    }
  }
  for (const code of needed.keys()) {
    const course = catalog.get(code);
    if (course && isSeniorCourse(course)) minYear.set(code, SENIOR_YEAR);
  }
  // Class standing grows by the per-term load; AP credit doesn't advance it.
  const standingCredits = done - recordOnly.credits.bySource.ap;
  const { earliest, late } = earliestTerms(ctx, catalog, needed, plannedTerm, onHand, {
    remaining,
    allTerms,
    minYear,
    standingAt: (credits) => Math.max(0, Math.ceil((credits - standingCredits) / Math.max(1, perTerm))),
  });

  /**
   * The "one of" choices in a rule where the student can still switch: every alternative is made of specific courses,
   * and none of those courses is taken or in progress. Planned ones come out of the plan with the switch.
   */
  const alternativesOf = (rule: Rule): RoadmapAlternative[][] => {
    const groups: RoadmapAlternative[][] = [];
    const visit = (r: Rule) => {
      if (r.type === "allOf") r.rules.forEach(visit);
      if (r.type !== "anyOf" || r.choice) return;
      const sets = r.rules.map((alt) => mandatoryCourses(alt));
      if (r.rules.length < 2 || sets.some((codes) => codes.length === 0 || codes.some((c) => !catalog.has(c)))) return;
      if (sets.some((codes) => codes.some((c) => taken.has(c) || (equivalents.get(c) ?? []).some((e) => taken.has(e))))) return;
      // The alternative the audit settled on is the one whose courses the roadmap needs.
      const current = sets.findIndex((codes) => codes.some((c) => needed.has(c) || plannedTerm.has(c)));
      if (current === -1) return;
      groups.push(
        sets.map((codes, i) => ({
          current: i === current,
          planned: codes.some((c) => plannedTerm.has(c)),
          courses: codes.map((code) => ({ code, title: catalog.get(code)?.title ?? "", credits: credits(code) })),
        })),
      );
    };
    visit(rule);
    return groups;
  };

  /**
   * "Choose 2 of HON 201, 301, 401": the listed courses the roadmap plans, each swappable for any other on the list the
   * student hasn't taken. Lists with a cap on some courses ("at most one of HON 300, 310") leave those out, since they need
   * approval. Only rules made purely of a course list qualify.
   */
  const seatsOf = (rule: Rule): RoadmapSeat[] => {
    const seats: RoadmapSeat[] = [];
    const visit = (r: Rule) => {
      if (r.type === "allOf" || (r.type === "anyOf" && !r.choice)) return r.rules.forEach(visit);
      if (r.type !== "choose" || !r.from.courses?.length || r.credits !== undefined) return;
      const sel = r.from;
      if (sel.subjects || sel.ranges || sel.minNumber !== undefined || sel.maxNumber !== undefined) return;
      const capped = new Set((r.constraints ?? []).flatMap((k) => (k.type === "maxFrom" ? (k.from.courses ?? []) : [])));
      const listed = (sel.courses ?? []).filter((c) => catalog.has(c) && !capped.has(c));
      const open = listed.filter((c) => !taken.has(c) && !(equivalents.get(c) ?? []).some((e) => taken.has(e)));
      const selected = open.filter((c) => needed.has(c) || plannedTerm.has(c));
      const info = (code: CourseCode): RoadmapSeatCourse => ({
        code,
        title: catalog.get(code)?.title ?? "",
        credits: credits(code),
        sbc: [...new Set((catalog.get(code)?.sbc ?? []).map((t) => t.category))],
      });
      for (const code of selected) {
        seats.push({
          selected: info(code),
          options: open.filter((c) => c === code || !selected.includes(c)).map(info),
          planned: plannedTerm.has(code),
        });
      }
    };
    visit(rule);
    return seats;
  };

  const counted = new Set<CourseCode>();
  const programs = result.programs.map((p): RoadmapProgram => {
    let creditsLeft = 0;
    const requirements = p.requirements
      .filter(listed)
      .map((r): RoadmapRequirement => {
        const codes = new Set(r.applied.map((a) => a.code).filter((c) => plannedTerm.has(c) || needed.has(c)));
        const courses = [...codes].map((code) => ({ ...describe(code), ...(earliest.has(code) && { earliest: earliest.get(code) }) }));
        for (const c of courses) {
          if (!counted.has(c.code)) creditsLeft += c.credits;
          counted.add(c.code);
        }
        const slots = slotItems.filter((x) => x.slot.programId === p.program.id && x.slot.requirementId === r.requirement.id).map((x) => x.slot);
        creditsLeft += slots.reduce((s, x) => s + x.credits - x.absorbed, 0);
        const requirementRule = p.program.requirements.find((x) => x.id === r.requirement.id)!.rule;
        const seats = seatsOf(requirementRule);
        const alternatives = alternativesOf(p.program.requirements.find((x) => x.id === r.requirement.id)!.rule);
        return {
          id: r.requirement.id,
          heading: requirementHeading(r.requirement),
          status: baseStatus.get(r.requirement.id) ?? r.status,
          courses,
          slots,
          review: r.missing.flatMap((m) => (m.kind === "review" ? [m.text] : [])),
          alternatives,
          seats,
          plannedSlotCredits: slotsInPlan.get(r.requirement.id) ?? 0,
          coveredSlots: coveredSlots.get(r.requirement.id) ?? [],
        };
      })
      .filter((r) => r.courses.length || r.slots.length || r.plannedSlotCredits > 0 || r.review.length || r.status === "needs-review");
    return {
      id: p.program.id,
      name: formatProgramName(p.program.name),
      kind: p.program.kind,
      requirements,
      done: p.satisfied,
      total: p.total,
      creditsLeft,
    };
  });

  const prerequisites = [...needed.keys()]
    .filter((c) => !counted.has(c))
    .map((code) => ({ ...describe(code), ...(earliest.has(code) && { earliest: earliest.get(code) }) }));

  return {
    programs,
    prerequisites,
    sbc,
    credits: {
      required: result.credits.required,
      done,
      planned: plannedCourseCredits + planPlaceholders,
      needed: neededCredits,
      slots: slotTotal,
      shared: sharedCredits,
      sbc: sbcCredits,
      free,
    },
    upperDivision: { required: ud.required, covered: udCovered, short: Math.max(0, ud.required - udCovered) },
    terms: { total: allTerms.length, used: allTerms.length - remaining.length, remaining, perTerm },
    late,
  };
}

function slotFor(item: Extract<MissingItem, { kind: "choose" }>, programId: string, requirementId: string): RoadmapSlot {
  const count = item.unit === "courses" ? item.remaining : Math.ceil(item.remaining / SLOT_CREDITS);
  const ranges = item.pool.ranges ?? [];
  return {
    programId,
    requirementId,
    remaining: item.remaining,
    unit: item.unit,
    count,
    credits: item.unit === "credits" ? item.remaining : count * SLOT_CREDITS,
    pool: describeSelector(item.pool),
    ...(item.option && { option: item.option }),
    sharesWith: [],
    also: [],
    absorbed: 0,
    lent: 0,
    ...(!item.pool.subjects?.length && !ranges.length && (item.pool.courses?.length ?? 0) <= MAX_LISTED && {
      options: (item.pool.courses ?? []).filter((c) => !item.exclude.includes(c)),
    }),
    upperDivision: isUpperDivisionPool(item.pool),
  };
}

/** Credits of class standing: U2 from 24, U3 from 57, U4 from 85. */
const STANDING_CREDITS = { U2: 24, U3: 57, U4: 85 } as const;

interface Bound {
  /** Lowest term ordinal allowed; -Infinity when nothing holds the course back. */
  start: number;
  /** A prerequisite neither on hand nor needed: the roadmap took another way, so this branch doesn't apply. */
  blocked?: boolean;
  /** The needed or planned course that sets `start`. */
  from?: CourseCode;
}
const FREE: Bound = { start: -Infinity };

/**
 * The soonest regular term each needed course can be taken: after its
 * prerequisites (in the same term when they may be concurrent), once the
 * student has the standing and academic year it asks for, in a season it runs.
 * Courses with no known season can go in either. Terms past the last semester
 * are counted on, so a course that can't fit says how late it lands.
 */
function earliestTerms(
  ctx: PlanContext,
  catalog: Map<CourseCode, CourseRecord>,
  needed: Map<CourseCode, string | undefined>,
  plannedTerm: Map<CourseCode, TermId>,
  onHand: (code: CourseCode) => boolean,
  opts: {
    remaining: TermId[];
    /** The degree's semesters from the first, for academic years. */
    allTerms: TermId[];
    minYear: Map<CourseCode, number>;
    /** Remaining semesters to finish before the student has this many standing credits. */
    standingAt: (credits: number) => number;
  },
): { earliest: Map<CourseCode, TermId>; late: Roadmap["late"] } {
  const { remaining, allTerms, minYear, standingAt } = opts;
  const first = remaining[0] ?? nextRegularTerm(ctx.student.currentTerm);
  const last = remaining.at(-1);
  /** The nth regular term from the first remaining one, counting past the degree's last. */
  const nth = (n: number) => {
    let t = first;
    for (let i = 0; i < n; i++) t = nextRegularTerm(t);
    return t;
  };
  const earliest = new Map<CourseCode, TermId>();
  const via = new Map<CourseCode, CourseCode>();
  const visiting = new Set<CourseCode>();

  const bound = (e: Prereq | undefined): Bound => {
    if (!e) return FREE;
    switch (e.type) {
      case "course": {
        if (needed.has(e.code) || plannedTerm.has(e.code)) {
          const t = termOf(e.code);
          return t === null ? FREE : { start: termOrdinal(t) + (e.concurrentAllowed ? 0 : 1), from: e.code };
        }
        return onHand(e.code) ? FREE : { start: -Infinity, blocked: true };
      }
      case "standing":
        return { start: termOrdinal(nth(standingAt(STANDING_CREDITS[e.level]))) };
      case "and": {
        const parts = e.of.map(bound).filter((p) => !p.blocked);
        return parts.reduce((a, b) => (b.start > a.start ? b : a), FREE);
      }
      case "or": {
        const parts = e.of.map(bound);
        if (parts.some((p) => !p.blocked && p.start === -Infinity)) return FREE;
        const open = parts.filter((p) => !p.blocked);
        return open.length ? open.reduce((a, b) => (b.start < a.start ? b : a)) : FREE;
      }
      default:
        return FREE;
    }
  };

  /** The term a course is or can be taken in; null when nothing places it (already taken, or a prerequisite cycle). */
  const termOf = (code: CourseCode): TermId | null => {
    if (plannedTerm.has(code)) return plannedTerm.get(code)!;
    if (!needed.has(code)) return null;
    if (earliest.has(code)) return earliest.get(code)!;
    if (visiting.has(code)) return null;
    visiting.add(code);

    const b = bound(catalog.get(code)?.prerequisites);
    const year = minYear.get(code) ?? 1;
    const seasons = seasonsOf(ctx, code);
    const startTerm = allTerms[yearStart(ctx.student, year, seasons)];
    const yearBound = startTerm ? termOrdinal(startTerm) : -Infinity;
    const startAt = Math.max(b.start, yearBound);
    let term = first;
    for (let i = 0; i < 40; i++, term = nextRegularTerm(term)) {
      if (termOrdinal(term) >= startAt && (!seasons?.length || seasons.includes(parseTerm(term).season))) break;
    }
    visiting.delete(code);
    earliest.set(code, term);
    if (b.from && b.start >= yearBound) via.set(code, b.from);
    return term;
  };
  for (const code of needed.keys()) termOf(code);

  const late: Roadmap["late"] = [];
  if (last) {
    for (const [code, term] of earliest) {
      if (termOrdinal(term) <= termOrdinal(last)) continue;
      const chain = [code];
      for (let c = via.get(code); c && chain.length < 8; c = via.get(c)) chain.unshift(c);
      late.push({ code, earliest: term, chain });
    }
  }
  return { earliest, late };
}
