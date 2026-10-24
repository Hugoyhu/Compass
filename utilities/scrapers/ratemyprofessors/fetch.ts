/**
 * Downloads Stony Brook's professor ratings from Rate My Professors into
 * data/catalog/professors.json.
 *
 *   npm run scrape:ratings
 *
 * Uses the site's GraphQL endpoint (the older /filter/professor/ JSON endpoint
 * that the ratemyprof-api Python package scrapes no longer exists). Professors
 * with no ratings are skipped. Requests are spaced out; run it occasionally,
 * not on every deploy.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ProfessorRatingsFileSchema, type ProfessorRating } from "@/lib/domain/catalog/professor";

const ENDPOINT = "https://www.ratemyprofessors.com/graphql";
/** "School-971" in base64: Stony Brook University (SUNY). */
const SCHOOL_ID = "U2Nob29sLTk3MQ==";
const PAGE_SIZE = 100;
const REQUEST_DELAY_MS = 1000;
const OUT_FILE = path.join(process.cwd(), "data/catalog/professors.json");

const QUERY = `query ($query: TeacherSearchQuery!, $count: Int!, $cursor: String) {
  search: newSearch {
    teachers(query: $query, first: $count, after: $cursor) {
      edges { node { legacyId firstName lastName department avgRating avgDifficulty numRatings wouldTakeAgainPercent } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

interface Node {
  legacyId: number;
  firstName: string;
  lastName: string;
  department: string;
  avgRating: number;
  avgDifficulty: number;
  numRatings: number;
  wouldTakeAgainPercent: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(cursor: string | null) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      // The site's own public client credential, not a secret.
      Authorization: "Basic dGVzdDp0ZXN0",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; compass-schedule-builder)",
    },
    body: JSON.stringify({ query: QUERY, variables: { query: { text: "", schoolID: SCHOOL_ID }, count: PAGE_SIZE, cursor } }),
  });
  if (!response.ok) throw new Error(`Rate My Professors answered ${response.status}`);
  const json = (await response.json()) as { data?: { search: { teachers: { edges: { node: Node }[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } }; errors?: unknown };
  if (!json.data) throw new Error(`Unexpected response: ${JSON.stringify(json.errors)}`);
  return json.data.search.teachers;
}

async function main() {
  const professors: ProfessorRating[] = [];
  let cursor: string | null = null;
  let seen = 0;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const { node: n } of page.edges) {
      seen++;
      if (n.numRatings === 0) continue;
      professors.push({
        id: n.legacyId,
        firstName: n.firstName.trim(),
        lastName: n.lastName.trim(),
        department: n.department,
        rating: n.avgRating,
        difficulty: n.avgDifficulty,
        numRatings: n.numRatings,
        wouldTakeAgain: n.wouldTakeAgainPercent >= 0 ? Math.round(n.wouldTakeAgainPercent) : null,
      });
    }
    console.log(`${seen} professors read`);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
    await sleep(REQUEST_DELAY_MS);
  }

  const file = ProfessorRatingsFileSchema.parse({
    source: {
      catalog: "Rate My Professors",
      url: "https://www.ratemyprofessors.com/school/971",
      fetchedAt: new Date().toISOString().slice(0, 10),
    },
    professors: professors.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)),
  });
  writeFileSync(OUT_FILE, JSON.stringify(file, null, 1) + "\n");
  console.log(`Wrote ${file.professors.length} rated professors to ${path.relative(process.cwd(), OUT_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
