/**
 * Assembles what the Degree Explorer renders: a browsable list of every
 * program in the catalog data, and one program's requirements with course
 * titles attached. Nothing here depends on the student record.
 */
import { getRepository } from "@/lib/data/repository";
import type { ProgramDefinition, Rule } from "@/lib/domain/catalog/program";
import { buildProgramOptions } from "@/lib/engine/program-options";
import { buildTypicalPath } from "@/lib/engine/typical-path";

export interface ProgramSummary {
  id: string;
  name: string;
  kind: ProgramDefinition["kind"];
  degree?: string;
  approxCredits?: number;
}

export interface CourseInfo {
  title: string;
  credits: string;
}

function walkRules(rule: Rule, visit: (rule: Rule) => void) {
  visit(rule);
  if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach((r) => walkRules(r, visit));
}

function programRules(program: ProgramDefinition): Rule[] {
  return [
    ...program.requirements.map((r) => r.rule),
    ...program.substitutions.map((s) => s.with),
    ...program.sbc.fulfillment.map((f) => f.rule),
  ];
}

function formatCredits({ min, max }: { min: number; max: number }): string {
  return min === max ? `${min} cr` : `${min}–${max} cr`;
}

export async function listProgramSummaries(): Promise<ProgramSummary[]> {
  const programs = await getRepository().listPrograms();
  return programs
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      degree: p.degree,
      approxCredits: p.approxCredits,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listProgramIds(): Promise<string[]> {
  return (await getRepository().listPrograms()).map((p) => p.id);
}

/** Every course code a program's rules, substitutions, and sample sequence name. */
export function programCourseCodes(program: ProgramDefinition): Set<string> {
  const codes = new Set<string>();
  for (const rule of programRules(program)) {
    walkRules(rule, (r) => {
      if (r.type === "course") codes.add(r.code);
      if (r.type === "choose") r.from.courses?.forEach((c) => codes.add(c));
    });
  }
  for (const term of program.sampleSequence ?? []) {
    for (const slot of term.slots) if (slot.kind === "course") [slot.code, ...(slot.alternatives ?? [])].forEach((c) => codes.add(c));
  }
  return codes;
}

/** Titles and credits for course codes; codes missing from the catalog are left out. */
export async function courseInfoFor(codes: Iterable<string>): Promise<Record<string, CourseInfo>> {
  const catalog = new Map((await getRepository().listCourses()).map((c) => [c.code, c]));
  const info: Record<string, CourseInfo> = {};
  for (const code of codes) {
    const course = catalog.get(code);
    if (course) info[code] = { title: course.title, credits: formatCredits(course.credits) };
  }
  return info;
}

/** One program plus titles for every course its rules and sample sequence name. */
export async function getProgramDetail(id: string) {
  const program = (await getRepository().listPrograms()).find((p) => p.id === id);
  if (!program) return null;
  const courses = await getRepository().listCourses();
  const path = buildTypicalPath(program, courses);
  const options = buildProgramOptions(program, courses);
  return { program, courseInfo: await courseInfoFor(programCourseCodes(program)), path, options };
}

export type ProgramDetail = NonNullable<Awaited<ReturnType<typeof getProgramDetail>>>;
