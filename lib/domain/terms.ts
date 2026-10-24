import type { Season, TermId } from "./types";

const SEASON_CODES = { Fall: "FA", Winter: "WI", Spring: "SP", Summer: "SU" } as const;
const CODE_TO_SEASON: Record<string, Season> = {
  FA: "Fall",
  WI: "Winter",
  SP: "Spring",
  SU: "Summer",
};

export function makeTerm(season: Season, year: number): TermId {
  return `${year}-${SEASON_CODES[season]}` as TermId;
}

export function parseTerm(term: TermId): { season: Season; year: number } {
  const [year, code] = term.split("-");
  return { season: CODE_TO_SEASON[code], year: Number(year) };
}

export function formatTerm(term: TermId): string {
  const { season, year } = parseTerm(term);
  return `${season} ${year}`;
}

/** Next regular (Fall/Spring) semester after the given term. */
export function nextRegularTerm(term: TermId): TermId {
  const { season, year } = parseTerm(term);
  return season === "Fall" ? makeTerm("Spring", year + 1) : makeTerm("Fall", year);
}

/** Sort key so terms compare chronologically. */
export function termOrdinal(term: TermId): number {
  const order: Record<Season, number> = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
  const { season, year } = parseTerm(term);
  return year * 4 + order[season];
}

/** The term right after this one, including Winter and Summer sessions. */
export function nextTerm(term: TermId): TermId {
  const { season, year } = parseTerm(term);
  const next: Record<Season, [Season, number]> = {
    Winter: ["Spring", year],
    Spring: ["Summer", year],
    Summer: ["Fall", year],
    Fall: ["Winter", year + 1],
  };
  return makeTerm(...next[season]);
}
