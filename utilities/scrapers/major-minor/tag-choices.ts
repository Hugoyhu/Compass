/**
 * Marks concentrations, specializations, and tracks in data/catalog/programs:
 * the requirement's top-level anyOf gets `choice`, an id, and a label for each
 * alternative, from choices.json. Requirements listed under "copies" take
 * another program's choice (the Political Science minor uses the BA's
 * concentrations) with a course count instead of credits.
 *
 *   npm run tag:choices
 *
 * Idempotent; rerun it after re-extracting programs.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ProgramDefinitionSchema, type ChoiceKind, type ProgramDefinition, type Rule } from "@/lib/domain/catalog/program";

const PROGRAMS_DIR = path.resolve("data/catalog/programs");
const MAPPING = path.resolve("utilities/scrapers/major-minor/choices.json");

interface Mapping {
  requirements: Record<string, { kind: ChoiceKind; labels: string[] }>;
  copies: Record<string, { from: string; count: number; title?: string }>;
}

/**
 * In a concentration's own pools, a level limit without a subject ("POL 214,
 * POL 216, …; numbered 200 or above") describes the listed courses. Under the
 * selector rules it would admit every course at that level, so it's dropped.
 */
function listedOnly(rule: Rule): Rule {
  if (rule.type === "allOf" || rule.type === "anyOf") return { ...rule, rules: rule.rules.map(listedOnly) };
  if (rule.type !== "choose" || !rule.from.courses?.length || rule.from.subjects?.length) return rule;
  const from = { ...rule.from };
  delete from.minNumber;
  delete from.maxNumber;
  return { ...rule, from };
}

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function main() {
  const mapping: Mapping = JSON.parse(readFileSync(MAPPING, "utf8"));
  const files = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith(".json"));
  const programs = new Map<string, { file: string; program: ProgramDefinition }>();
  for (const file of files) {
    const program = JSON.parse(readFileSync(path.join(PROGRAMS_DIR, file), "utf8")) as ProgramDefinition;
    programs.set(program.id, { file, program });
  }
  const requirementOf = (id: string) => {
    for (const { program } of programs.values()) {
      const r = program.requirements.find((x) => x.id === id);
      if (r) return { program, requirement: r };
    }
    throw new Error(`No requirement ${id}`);
  };

  const changed = new Set<string>();
  for (const [id, { kind, labels }] of Object.entries(mapping.requirements)) {
    const { program, requirement } = requirementOf(id);
    const rule = requirement.rule;
    if (rule.type !== "anyOf") throw new Error(`${id} is ${rule.type}, not anyOf`);
    if (rule.rules.length !== labels.length) throw new Error(`${id} has ${rule.rules.length} alternatives, ${labels.length} labels`);
    const nodeId = rule.id ?? `${id}.choice`;
    requirement.rule = {
      ...rule,
      id: nodeId,
      choice: kind,
      rules: rule.rules.map((alt, i) => ({ ...listedOnly(alt), id: alt.id ?? `${id}.${slug(labels[i])}`, label: labels[i] })),
    };
    changed.add(program.id);
  }

  for (const [id, { from, count, title }] of Object.entries(mapping.copies)) {
    const { program, requirement } = requirementOf(id);
    const source = requirementOf(from).requirement.rule;
    if (source.type !== "anyOf" || !source.choice) throw new Error(`${from} isn't a tagged choice`);
    const recount = (alt: Rule): Rule => {
      if (alt.type !== "choose") throw new Error(`${from} alternatives must be course pools to copy`);
      const recounted = { ...alt, count };
      delete recounted.credits;
      return recounted;
    };
    requirement.rule = {
      type: "anyOf",
      id: `${id}.choice`,
      choice: source.choice,
      sourceText: requirement.sourceText,
      rules: source.rules.map((alt) => ({ ...recount(alt), id: `${id}.${alt.id!.split(".").at(-1)}`, label: alt.label })),
    };
    if (title) requirement.title = title;
    changed.add(program.id);
  }

  for (const id of changed) {
    const { file, program } = programs.get(id)!;
    ProgramDefinitionSchema.parse(program);
    writeFileSync(path.join(PROGRAMS_DIR, file), JSON.stringify(program, null, 2) + "\n");
  }
  console.log(`Tagged choices in ${changed.size} programs`);
}

main();
