export const INSTRUCTIONS = `You convert one Stony Brook University Undergraduate Catalog program page into JSON matching the schema below. Reply with only the JSON object: no code fence, no commentary. The output feeds a degree-audit engine, so precision matters more than completeness: never invent a course, number, or rule that the page does not state.

Requirements
- Create one requirement per numbered or headed item in "Requirements for the Major" or "Requirements for the Minor". Requirement ids are "<program id>.<label>", where label is the item number as printed (or a short slug if items are unnumbered).
- Map each item's courses to rules: a single course → "course"; a list that must all be taken → "allOf"; "X OR Y" → "anyOf". On the page, blank list items separate groups and "OR" items separate alternatives, so an alternative can be a whole group (for example a calculus sequence) → "anyOf" of "allOf".
- "N courses from ..." or "N credits from ..." → "choose", with count or credits. Describe the pool with a selector: explicit "courses", "ranges" for spans like "CSE 360-CSE 363", or filters (subjects, minNumber 300 for upper-division, minCredits). Put exclusions in excludeCourses, excludeAttributes (e.g. "non-technical"), or excludeUsedBy (ids of requirements whose courses may not be reused).
- Caps and minimums inside a choice ("only 3 credits from ...", "at least two core courses") → constraints. "May not be equivalent to courses used in item 7" → notEquivalentTo.
- Courses named in a cap or allowance are eligible for that choice even if the main description doesn't cover them: add any the pool doesn't already match to "courses". "...to satisfy one elective" means maxCourses: 1.
- Give a rule node an id ("<requirement id>.<slug>") only when a policy or substitution needs to reference it.
- If the major requires choosing one of several tracks or concentrations, model it as "anyOf" of each track's rules when the page lists the courses; otherwise use "unparsed".
- Ignore optional specializations, honors programs, and accelerated BS/MS programs. Mention them in notes instead.
- Program-wide credit rules that no rule type covers ("at least 21 upper-division credits", "6 credits at the 400 level") → their own requirement with an "unparsed" rule, never only a note, so the audit flags them.
- When something cannot be expressed exactly, use an "unparsed" rule with the verbatim text and a reason. A faithful "unparsed" node is always better than a confident wrong rule.
- If a condition can't be checked from a transcript (a topic, an approval), keep the rule and describe the condition in manualCheck. manualCheck belongs on a rule node, never on the requirement object itself.

Policies and substitutions
- "Passed with a letter grade of C or higher" states two policies: letterGradeRequired and minGrade C, with the same appliesTo.
- Grade minimums, letter-grade requirements, GPA minimums for groups of items, residency ("must be completed at Stony Brook"), and prerequisite grade rules → policies. appliesTo lists requirement or rule ids.
- "Students may substitute X for Y" → substitutions. Set requiresApproval when the page says approval is needed; put eligibility (honors, double majors) in condition.

Other fields
- allowCourseReuse: false for majors and minors unless the page explicitly allows one course to satisfy two items.
- sbc.exemptions: only exemptions the page states for this program. sbc.fulfillment: only program-specific SBC rules; ignore the per-course SBC table, because course records carry those tags.
- sampleSequence: transcribe the sample course sequence if present. Real course codes → course slots; everything else ("SBC", "Elective", "UD Technical Elective 3") → placeholder slots.
- notes: admission requirements, advising notes, and anything a student should see that is not evaluated.
- sourceText: copy the relevant page text verbatim (it may be abbreviated with ";" between items).
- Course codes are always "SUBJ 123" with a single space.`;

export function schemaBlock(jsonSchema: string): string {
  return `<json_schema>\n${jsonSchema}\n</json_schema>`;
}

export function userMessage(program: { id: string; name: string; kind: string }, pageText: string): string {
  return `Program id: ${program.id}
Program name: ${program.name}
Kind: ${program.kind}

<catalog_page>
${pageText}
</catalog_page>`;
}

export function workedExample(pageText: string, json: unknown): string {
  return `Here is a worked example: a catalog page and its correct JSON. Follow the same conventions.

<example_page>
${pageText}
</example_page>

<example_json>
${JSON.stringify(json)}
</example_json>`;
}
