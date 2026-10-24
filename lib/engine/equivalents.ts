/** Folds courses the catalog says can't both be taken for credit (AMS 151, MAT 125, MAT 131) into groups. */
import type { CourseRecord } from "@/lib/domain/catalog/course";
import type { CourseCode } from "@/lib/domain/types";

export interface EquivalentGroup {
  /** The course that lists the others as its equivalents; the one to show. */
  code: CourseCode;
  /** Every course in the group, including `code`, in catalog order. */
  members: CourseCode[];
}

/** Only courses in `codes` are grouped; an equivalent outside it is ignored. */
export function foldEquivalents(codes: Iterable<CourseCode>, catalog: Map<CourseCode, CourseRecord>): EquivalentGroup[] {
  const named = new Set(codes);
  const parent = new Map<CourseCode, CourseCode>([...named].map((c) => [c, c]));
  const find = (c: CourseCode): CourseCode => (parent.get(c) === c ? c : find(parent.get(c)!));
  for (const code of named) {
    for (const other of catalog.get(code)?.equivalents ?? []) if (named.has(other)) parent.set(find(other), find(code));
  }
  const groups = new Map<CourseCode, CourseCode[]>();
  for (const code of [...named].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
    groups.set(find(code), [...(groups.get(find(code)) ?? []), code]);
  }
  return [...groups.values()].map((members) => ({
    code: [...members].sort((a, b) => (catalog.get(b)?.equivalents.length ?? 0) - (catalog.get(a)?.equivalents.length ?? 0))[0],
    members,
  }));
}
