/**
 * Matches instructor names from the class schedule ("Aruna Sharma") to Rate My
 * Professors records. Names are the only link between the two, so a match must
 * be unambiguous: when two professors fit, none is returned.
 */
import type { ProfessorRating } from "@/lib/domain/catalog/professor";

const placeholders = new Set(["staff", "tba", ""]);

function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "");
}

/** Names the schedule lists for a meeting: one, or several separated by commas. */
export function instructorNames(text: string): string[] {
  return text
    .split(",")
    .map((n) => n.trim())
    .filter((n) => !placeholders.has(n.toLowerCase()));
}

export function buildRatingIndex(professors: ProfessorRating[]): (name: string) => ProfessorRating | null {
  const exact = new Map<string, ProfessorRating[]>();
  const byInitial = new Map<string, ProfessorRating[]>();
  const add = (map: Map<string, ProfessorRating[]>, key: string, p: ProfessorRating) => map.set(key, [...(map.get(key) ?? []), p]);
  for (const p of professors) {
    const first = plain(p.firstName).split(/\s+/).filter(Boolean)[0] ?? "";
    const last = plain(p.lastName).replace(/\s+/g, "");
    if (!first || !last) continue;
    add(exact, `${first}|${last}`, p);
    add(byInitial, `${first[0]}|${last}`, p);
  }
  // Two professors fitting the same name means we can't tell which one is teaching.
  const pick = (matches: ProfessorRating[] | undefined) =>
    matches?.length === 1 ? matches[0] : null;

  return (name) => {
    const words = plain(name).split(/\s+/).filter(Boolean);
    if (words.length < 2) return null;
    const first = words[0];
    // "Maria De La Cruz": the last name is everything after the first word, or just the final word.
    const lasts = [...new Set([words.slice(1).join(""), words[words.length - 1]])];
    for (const last of lasts) {
      const hit = pick(exact.get(`${first}|${last}`));
      if (hit) return hit;
    }
    for (const last of lasts) {
      const hit = pick(byInitial.get(`${first[0]}|${last}`));
      if (hit) return hit;
    }
    return null;
  };
}
