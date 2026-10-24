/**
 * Cross-reference checks that a schema can't express: ids must be unique and
 * resolvable, and referenced courses should exist in the course catalog.
 * Used by the catalog validation script and, later, by the extraction pipeline.
 */
import type { CourseSelector, ProgramDefinition, Rule } from "./program";

export interface Issue {
  level: "error" | "warning";
  path: string;
  message: string;
}

function walkRule(rule: Rule, visit: (rule: Rule) => void) {
  visit(rule);
  if (rule.type === "allOf" || rule.type === "anyOf") rule.rules.forEach((r) => walkRule(r, visit));
}

function selectorCourses(selector: CourseSelector): string[] {
  return [...(selector.courses ?? []), ...(selector.excludeCourses ?? [])];
}

/**
 * Whether `code` is in the selector's pool, per the CourseSelector rules.
 * Credit and attribute filters need course data, so they're treated as passing.
 */
export function selectorMatches(selector: CourseSelector, code: string): boolean {
  if (selector.excludeCourses?.includes(code)) return false;
  const [subject, numberText] = code.split(" ");
  const number = Number(numberText);
  if (selector.courses?.includes(code)) return true;
  if (selector.ranges?.some((r) => r.subject === subject && number >= r.from && number <= r.to)) return true;
  const hasFilter =
    selector.subjects !== undefined ||
    selector.minNumber !== undefined ||
    selector.maxNumber !== undefined ||
    selector.minCredits !== undefined;
  return (
    hasFilter &&
    (selector.subjects === undefined || selector.subjects.includes(subject)) &&
    (selector.minNumber === undefined || number >= selector.minNumber) &&
    (selector.maxNumber === undefined || number <= selector.maxNumber)
  );
}

/** All course codes a program mentions, for checking against the course catalog. */
export function referencedCourses(program: ProgramDefinition): Set<string> {
  const codes = new Set<string>();
  const fromRule = (rule: Rule) =>
    walkRule(rule, (r) => {
      if (r.type === "course") codes.add(r.code);
      if (r.type === "choose") {
        selectorCourses(r.from).forEach((c) => codes.add(c));
        r.constraints?.forEach((k) => {
          if (k.type === "maxFrom" || k.type === "minFrom") selectorCourses(k.from).forEach((c) => codes.add(c));
          if (k.type === "onePerGroup") k.groups.flat().forEach((c) => codes.add(c));
        });
      }
    });
  program.requirements.forEach((req) => fromRule(req.rule));
  program.substitutions.forEach((s) => {
    if (s.replaces.type === "courses") s.replaces.courses.forEach((c) => codes.add(c));
    fromRule(s.with);
  });
  program.sbc.fulfillment.forEach((f) => fromRule(f.rule));
  return codes;
}

export function checkProgramReferences(program: ProgramDefinition, knownCourses?: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const ids = new Map<string, string>();
  const register = (id: string, path: string) => {
    if (ids.has(id)) issues.push({ level: "error", path, message: `Duplicate id "${id}" (also at ${ids.get(id)})` });
    else ids.set(id, path);
    if (!id.startsWith(`${program.id}.`)) {
      issues.push({ level: "warning", path, message: `Id "${id}" should start with "${program.id}."` });
    }
  };

  program.requirements.forEach((req, i) => {
    register(req.id, `requirements[${i}]`);
    walkRule(req.rule, (r) => r.id && register(r.id, `requirements[${i}] (${req.id})`));
  });
  program.substitutions.forEach((s, i) => register(s.id, `substitutions[${i}]`));

  const requireId = (id: string, path: string) => {
    if (!ids.has(id)) issues.push({ level: "error", path, message: `Unknown requirement or rule id "${id}"` });
  };
  program.policies.forEach((p, i) => {
    if ("appliesTo" in p) p.appliesTo.forEach((id) => requireId(id, `policies[${i}] (${p.type})`));
  });
  program.substitutions.forEach((s, i) => {
    if (s.replaces.type === "rule") requireId(s.replaces.ruleId, `substitutions[${i}]`);
  });
  program.requirements.forEach((req, i) =>
    walkRule(req.rule, (r) => {
      if (r.type !== "choose") return;
      const path = `requirements[${i}] (${req.id})`;
      r.from.excludeUsedBy?.forEach((id) => requireId(id, path));
      r.constraints?.forEach((k) => k.type === "notEquivalentTo" && requireId(k.requirementId, path));
      // A cap or minimum naming a course the pool can't select has no effect, which usually means the pool is too narrow.
      r.constraints?.forEach((k) => {
        if (k.type !== "maxFrom" && k.type !== "minFrom") return;
        const outside = (k.from.courses ?? []).filter((c) => !selectorMatches(r.from, c));
        if (outside.length > 0) {
          issues.push({
            level: "error",
            path,
            message: `${k.type} names ${outside.join(", ")}, which the choose pool can't select. Courses named in a cap or minimum are eligible; add them to the pool's courses.`,
          });
        }
      });
      if (r.count === undefined && r.credits === undefined) {
        issues.push({ level: "error", path, message: "choose rule needs count or credits" });
      }
    }),
  );

  if (knownCourses) {
    const missing = [...referencedCourses(program)].filter((c) => !knownCourses.has(c)).sort();
    if (missing.length > 0) {
      issues.push({
        level: "warning",
        path: "(courses)",
        message: `${missing.length} referenced courses not in the course catalog: ${missing.join(", ")}`,
      });
    }
  }
  return issues;
}
