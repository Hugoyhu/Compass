"use server";

import { CourseCodeSchema } from "@/lib/domain/catalog/common";
import { getCourseDetail } from "@/lib/services/courses";
import { getStudentRecord } from "@/lib/student/store";
import { TermIdSchema } from "@/lib/student/record";
import { ClassNumbersSchema, writeSchedule } from "@/lib/student/schedule";
import type { SaveResult } from "./record";

/** The catalog details the Schedule Builder's course dialog shows, or null for an unknown course. */
export async function getScheduleCourseDetail(code: unknown) {
  const parsed = CourseCodeSchema.safeParse(code);
  if (!parsed.success) return null;
  const detail = await getCourseDetail(parsed.data, await getStudentRecord());
  if (!detail) return null;
  const { course, credits, prereqCourses, unverifiable } = detail;
  return { course, credits, prereqCourses, unverifiable };
}

/** Saves the sections picked for a term, to the cookie and (signed in) the account. */
export async function saveSchedule(term: unknown, classNumbers: unknown): Promise<SaveResult> {
  const parsedTerm = TermIdSchema.safeParse(term);
  const parsedNumbers = ClassNumbersSchema.safeParse(classNumbers);
  if (!parsedTerm.success || !parsedNumbers.success) return { ok: false, error: "That schedule couldn't be saved" };
  try {
    await writeSchedule(parsedTerm.data, parsedNumbers.data);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
