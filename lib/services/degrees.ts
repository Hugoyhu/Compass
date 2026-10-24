/**
 * Assembles what the Degree Explorer renders: a browsable list of every
 * program in the catalog data, and one program's requirements with course
 * titles attached. Nothing here depends on the student record.
 */
import { getRepository } from "@/lib/data/repository";
import type { ProgramDefinition, Rule } from "@/lib/domain/catalog/program";

export interface ProgramSummary {
  id: string;
  name: string;
  kind: ProgramDefinition["kind"];
  degree?: string;
  approxCredits?: number;
  requirementCount: number;
  /** Rule nodes the extractor couldn't structure; shown as catalog text only. */
  unparsedCount: number;
  reviewed: boolean;
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

function countUnparsed(program: ProgramDefinition): number {
  let count = 0;
  for (const rule of program.requirements.map((r) => r.rule)) walkRules(rule, (r) => r.type === "unparsed" && count++);
  return count;
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
      requirementCount: p.requirements.length,
      unparsedCount: countUnparsed(p),
      reviewed: p.review.status === "reviewed",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listProgramIds(): Promise<string[]> {
  return (await getRepository().listPrograms()).map((p) => p.id);
}

/** One program plus titles for every course its rules and sample sequence name. */
export async function getProgramDetail(id: string) {
  const repo = getRepository();
  const [programs, courses] = await Promise.all([repo.listPrograms(), repo.listCourses()]);
  const program = programs.find((p) => p.id === id);
  if (!program) return null;

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

  const catalog = new Map(courses.map((c) => [c.code, c]));
  const courseInfo: Record<string, CourseInfo> = {};
  for (const code of codes) {
    const course = catalog.get(code);
    if (course) courseInfo[code] = { title: course.title, credits: formatCredits(course.credits) };
  }

  return { program, courseInfo, unparsedCount: countUnparsed(program) };
}

export type ProgramDetail = NonNullable<Awaited<ReturnType<typeof getProgramDetail>>>;
