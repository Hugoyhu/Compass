/**
 * DEMO SEED COURSES — a stand-in until data/catalog/courses.json exists.
 *
 * Course codes, titles, and credits for CS BS courses come from the Fall 2026
 * Computer Science, BS catalog page. Prerequisites, offering seasons,
 * equivalencies, and most SBC tags are approximate and may be wrong.
 * General-education course titles are illustrative. Records use the same
 * CourseRecord shape the course scraper will produce.
 */
import type { CourseRecord, Prereq } from "@/lib/domain/catalog/course";
import type { SbcCode, Season } from "@/lib/domain/catalog/common";

const SOURCE = {
  catalog: "Demo seed (titles and credits from the Fall 2026 CS BS page; prerequisites and offerings approximate)",
  url: "https://catalog.stonybrook.edu/preview_program.php?catoid=11&poid=1411",
  fetchedAt: "2026-10-24",
};

const c = (code: string, concurrentAllowed?: boolean): Prereq => ({ type: "course", code, concurrentAllowed });
const and = (...of: Prereq[]): Prereq => ({ type: "and", of });
const or = (...of: Prereq[]): Prereq => ({ type: "or", of });
const LINEAR_ALGEBRA = or(c("AMS 210"), c("MAT 211"));

function course(
  code: string,
  title: string,
  credits: number | [number, number],
  opts: {
    sbc?: (SbcCode | `${SbcCode}~`)[];
    prereq?: Prereq;
    offered?: Season[];
    attributes?: string[];
    equivalents?: string[];
  } = {},
): CourseRecord {
  const [min, max] = Array.isArray(credits) ? credits : [credits, credits];
  return {
    code,
    title,
    credits: { min, max },
    description: "",
    // A trailing "~" marks partial fulfillment.
    sbc: (opts.sbc ?? []).map((tag) =>
      tag.endsWith("~") ? { category: tag.slice(0, -1) as SbcCode, partial: true } : { category: tag as SbcCode },
    ),
    prerequisites: opts.prereq,
    equivalents: opts.equivalents ?? [],
    attributes: opts.attributes ?? [],
    typicallyOffered: opts.offered ?? ["Fall", "Spring"],
    source: SOURCE,
  };
}

export const seedCourses: CourseRecord[] = [
  // --- Introductory CSE (requirement 1) -------------------------------------
  course("CSE 113", "Foundations of Computer Science I", 4, { prereq: or(c("AMS 151", true), c("MAT 125", true), c("MAT 131", true)) }),
  course("CSE 150", "Foundations of Computer Science: Honors", 4, { attributes: ["honors"] }),
  course("CSE 114", "Introduction to Object-Oriented Programming", 4, { sbc: ["TECH"] }),
  course("CSE 213", "Foundations of Computer Science II", 4, { prereq: or(c("CSE 113"), c("CSE 150")) }),
  course("CSE 214", "Data Structures", 4, { prereq: c("CSE 114") }),
  course("CSE 220", "Systems Fundamentals I", 4, { prereq: c("CSE 214") }),

  // --- Advanced CSE (requirement 2) and non-technical (requirement 9) --------
  course("CSE 307", "Principles of Programming Languages", 3, { prereq: and(c("CSE 213"), c("CSE 214")) }),
  course("CSE 316", "Fundamentals of Software Development", 3, {
    sbc: ["EXP+~", "SBS+~", "STEM+~", "ESI~"],
    prereq: and(c("CSE 214"), c("CSE 220")),
  }),
  course("CSE 320", "Systems Fundamentals II", 3, { prereq: c("CSE 220") }),
  course("CSE 373", "Analysis of Algorithms", 3, { prereq: and(c("CSE 213"), c("CSE 214"), LINEAR_ALGEBRA) }),
  course("CSE 385", "Analysis of Algorithms: Honors", 4, {
    prereq: and(c("CSE 213"), c("CSE 214"), LINEAR_ALGEBRA),
    attributes: ["honors"],
    offered: ["Spring"],
  }),
  course("CSE 356", "Cloud Computing", 3, { sbc: ["EXP+~"], prereq: and(c("CSE 316"), c("CSE 320")) }),
  course("CSE 416", "Software Engineering", 3, { sbc: ["EXP+~", "SBS+~", "STEM+~", "ESI~"], prereq: c("CSE 316") }),
  course("CSE 300", "Technical Communications", 3, {
    sbc: ["SPK", "WRTD"],
    prereq: and(c("WRT 102"), c("CSE 214")),
    attributes: ["non-technical"],
  }),
  course("CSE 312", "Social, Legal, and Ethical Issues in Computing", 3, {
    sbc: ["STAS", "CER", "ESI"],
    prereq: and(c("CSE 214"), { type: "standing", level: "U3" }),
    attributes: ["non-technical"],
  }),

  // --- Upper-division CSE electives (requirement 3) -------------------------
  course("CSE 304", "Compiler Design", 3, { prereq: and(c("CSE 220"), c("CSE 307")), offered: ["Fall"] }),
  course("CSE 306", "Operating Systems", 3, { sbc: ["EXP+~", "SBS+~", "STEM+~", "ESI~"], prereq: c("CSE 320") }),
  course("CSE 310", "Computer Networks", 3, { prereq: and(c("CSE 214"), c("CSE 220")) }),
  course("CSE 311", "Systems Administration", 3, { prereq: c("CSE 220") }),
  course("CSE 323", "Human-Computer Interaction", 3, { prereq: c("CSE 214") }),
  course("CSE 327", "Fundamentals of Computer Vision", 3, { prereq: and(c("CSE 214"), LINEAR_ALGEBRA) }),
  course("CSE 328", "Fundamentals of Computer Graphics", 3, { prereq: and(c("CSE 220"), LINEAR_ALGEBRA) }),
  course("CSE 331", "Computer Security Fundamentals", 3, { prereq: c("CSE 320") }),
  course("CSE 332", "Introduction to Visualization", 3, { prereq: c("CSE 214") }),
  course("CSE 333", "User Interface Development", 3, { prereq: c("CSE 316") }),
  course("CSE 334", "Introduction to Multimedia Systems", 3, { prereq: c("CSE 214") }),
  course("CSE 336", "Internet Programming", 3, { prereq: c("CSE 316") }),
  course("CSE 337", "Scripting Languages", 3, { prereq: c("CSE 214") }),
  course("CSE 351", "Introduction to Data Science", 3, { prereq: and(c("CSE 214"), c("AMS 310")) }),
  course("CSE 352", "Artificial Intelligence", 3, { prereq: and(c("CSE 214"), c("AMS 310")) }),
  course("CSE 353", "Machine Learning", 3, { prereq: and(c("CSE 214"), c("AMS 310"), LINEAR_ALGEBRA) }),
  course("CSE 354", "Natural Language Processing", 3, { prereq: c("CSE 353") }),
  course("CSE 355", "Computational Geometry", 3, { prereq: c("CSE 373"), offered: ["Fall"] }),
  course("CSE 357", "Statistical Methods for Data Science", 3, { prereq: and(c("CSE 214"), c("AMS 310")), offered: ["Spring"] }),
  course("CSE 360", "Software Security", 3, { prereq: c("CSE 331") }),
  course("CSE 361", "Web Security", 3, { prereq: c("CSE 331") }),
  course("CSE 362", "Mobile Security", 3, { prereq: c("CSE 331"), offered: ["Spring"] }),
  course("CSE 363", "Offensive Security", 3, { prereq: c("CSE 331") }),
  course("CSE 364", "Advanced Multimedia Techniques", 3, { prereq: c("CSE 334"), offered: ["Spring"] }),
  course("CSE 366", "Introduction to Virtual Reality", 3, { prereq: c("CSE 328"), offered: ["Fall"] }),
  course("CSE 371", "Logic", 3, { prereq: c("CSE 213"), offered: ["Fall"] }),
  course("CSE 376", "Advanced Systems Programming in UNIX/C", 3, { prereq: c("CSE 320") }),
  course("CSE 378", "Introduction to Robotics", 3, { prereq: and(c("CSE 214"), LINEAR_ALGEBRA) }),
  course("CSE 380", "2D Game Programming", 3, { prereq: c("CSE 316"), offered: ["Fall"] }),
  course("CSE 381", "3D Game Programming", 3, { prereq: and(c("CSE 380"), c("CSE 328")), offered: ["Spring"] }),
  course("CSE 390", "Special Topics in Computer Science", 3, { prereq: { type: "permission", text: "Permission of instructor" } }),
  course("CSE 487", "Research in Computer Science", [0, 3], { prereq: { type: "permission", text: "Permission of instructor" } }),
  course("CSE 495", "Senior Honors Research Project I", 3, { prereq: { type: "permission", text: "Honors program" } }),
  course("CSE 496", "Senior Honors Research Project II", 3, { prereq: c("CSE 495") }),

  // --- Mathematics (requirements 4–6) ---------------------------------------
  course("AMS 151", "Applied Calculus I", 3, { sbc: ["QPS"] }),
  course("AMS 161", "Applied Calculus II", 3, { sbc: ["QPS"], prereq: c("AMS 151") }),
  course("MAT 125", "Calculus A", 3, { sbc: ["QPS"] }),
  course("MAT 126", "Calculus B", 3, { sbc: ["QPS"], prereq: c("MAT 125") }),
  course("MAT 127", "Calculus C", 3, { sbc: ["QPS"], prereq: c("MAT 126") }),
  course("MAT 131", "Calculus I", 4, { sbc: ["QPS"] }),
  course("MAT 132", "Calculus II", 4, { sbc: ["QPS"], prereq: c("MAT 131") }),
  course("MAT 211", "Introduction to Linear Algebra", 3, { sbc: ["STEM+"], prereq: or(c("AMS 151"), c("MAT 131"), c("MAT 125")) }),
  course("AMS 210", "Applied Linear Algebra", 3, { prereq: or(c("AMS 151"), c("MAT 131"), c("MAT 125")) }),
  course("AMS 310", "Survey of Probability and Statistics", 3, {
    sbc: ["STEM+"],
    prereq: or(c("AMS 161"), c("MAT 127"), c("MAT 132")),
  }),

  // --- Natural science (requirements 7–8) -----------------------------------
  course("BIO 201", "Fundamentals of Biology: Organisms to Ecosystems", 3, { sbc: ["SNW"] }),
  course("BIO 202", "Fundamentals of Biology: Molecular and Cellular Biology", 3),
  course("BIO 203", "Fundamentals of Biology: Cellular and Organ Physiology", 3),
  course("BIO 204", "Fundamentals of Scientific Inquiry in the Biological Sciences I", 2, { attributes: ["lab"] }),
  course("CHE 131", "General Chemistry IB", 4, { sbc: ["SNW"], equivalents: ["CHE 152"] }),
  course("CHE 132", "General Chemistry II", 4, { sbc: ["SNW"], prereq: c("CHE 131") }),
  course("CHE 133", "General Chemistry Laboratory I", 1, { attributes: ["lab"] }),
  course("CHE 152", "Molecular Science I", 4, { sbc: ["SNW"], equivalents: ["CHE 131"], offered: ["Fall"] }),
  course("CHE 154", "Molecular Science Laboratory I", 2, { attributes: ["lab"], offered: ["Fall"] }),
  course("CHE 321", "Organic Chemistry I", 4, { prereq: c("CHE 132") }),
  course("CHE 322", "Organic Chemistry IIA", 4, { prereq: c("CHE 321") }),
  course("CHE 331", "Molecular Science II", 4, { prereq: c("CHE 152"), offered: ["Spring"] }),
  course("CHE 332", "Molecular Science III", 4, { prereq: c("CHE 331"), offered: ["Fall"] }),
  course("PHY 125", "Classical Physics A", 3, { sbc: ["SNW"], equivalents: ["PHY 131", "PHY 141"] }),
  course("PHY 126", "Classical Physics B", 3, { sbc: ["SNW"], prereq: c("PHY 125") }),
  course("PHY 127", "Classical Physics C", 3, { sbc: ["SNW"], prereq: c("PHY 126") }),
  course("PHY 131", "Classical Physics I", 3, { sbc: ["SNW"], prereq: c("MAT 131", true), equivalents: ["PHY 125", "PHY 141"] }),
  course("PHY 132", "Classical Physics II", 3, { sbc: ["SNW"], prereq: or(c("PHY 131"), c("PHY 141")), equivalents: ["PHY 142"] }),
  course("PHY 133", "Classical Physics Laboratory I", 1, { attributes: ["lab"] }),
  course("PHY 141", "Classical Physics I: Honors", 3, { sbc: ["SNW"], equivalents: ["PHY 125", "PHY 131"], offered: ["Fall"] }),
  course("PHY 142", "Classical Physics II: Honors", 3, { sbc: ["SNW"], prereq: c("PHY 141"), equivalents: ["PHY 132"], offered: ["Spring"] }),
  course("PHY 251", "Modern Physics", 3, { prereq: c("PHY 132") }),
  course("AST 203", "Astronomy", 4),
  course("AST 205", "Introduction to Planetary Sciences", 3),

  // --- Writing and general education (titles illustrative) ------------------
  course("WRT 101", "Introductory Writing Workshop", 3),
  course("WRT 102", "Intermediate Writing Workshop", 3, { sbc: ["WRT"], prereq: c("WRT 101") }),
  course("ECO 108", "Introduction to Economics", 3, { sbc: ["SBS"] }),
  course("PSY 103", "Introduction to Psychology", 3, { sbc: ["SBS"] }),
  course("PSY 260", "Survey in Cognition and Perception", 3, { sbc: ["STEM+"], prereq: c("PSY 103") }),
  course("HIS 104", "United States since 1877", 3, { sbc: ["SBS", "USA"] }),
  course("ARH 101", "Art in Culture", 3, { sbc: ["ARTS"] }),
  course("PHI 104", "Moral Reasoning", 3, { sbc: ["HUM", "CER"] }),
  course("EGL 121", "Global Literature", 3, { sbc: ["HUM", "GLO"] }),
  course("WST 102", "Introduction to Women's and Gender Studies", 3, { sbc: ["SBS", "DIV"] }),
  course("MUS 101", "Introduction to Music", 3, { sbc: ["ARTS"] }),
];
