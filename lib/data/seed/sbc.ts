/**
 * Stony Brook Curriculum (SBC) objectives the audit checks.
 *
 * Names follow the Undergraduate Catalog. The upper-tier "Pursue Deeper
 * Understanding" categories (EXP+, HFA+, SBS+, STEM+) are not audited yet:
 * their rules involve partial fulfillment across courses.
 */
import type { SbcCategory } from "@/lib/domain/types";

export const seedSbcCategories: SbcCategory[] = [
  { code: "WRT", name: "Write Effectively in English" },
  { code: "QPS", name: "Master Quantitative Problem Solving" },
  { code: "SNW", name: "Study the Natural World" },
  { code: "TECH", name: "Understand Technology" },
  { code: "ARTS", name: "Explore and Understand the Fine and Performing Arts" },
  { code: "HUM", name: "Address Problems Using Critical Analysis and the Methods of the Humanities" },
  { code: "SBS", name: "Understand, Observe, and Analyze Human Behavior and the Structure and Functioning of Society" },
  { code: "USA", name: "Understand the Political, Economic, Social, and Cultural History of the United States" },
  { code: "GLO", name: "Engage Global Issues" },
  { code: "LANG", name: "Communicate in a Human Language Other Than English" },
  { code: "STAS", name: "Understand Relationships between Science or Technology and the Arts, Humanities, or Social Sciences" },
  { code: "CER", name: "Practice and Respect Critical and Ethical Reasoning" },
  { code: "DIV", name: "Understand, Value, and Appreciate Human Diversity" },
  { code: "ESI", name: "Evaluate and Synthesize Researched Information" },
  { code: "SPK", name: "Speak Effectively Before an Audience" },
  { code: "WRTD", name: "Write Effectively within One's Discipline" },
];

/** University-wide credit rules (Undergraduate Catalog degree requirements). */
export const universityCreditRules = {
  totalCredits: 120,
  upperDivisionCredits: 39,
  upperDivisionMinNumber: 300,
};
