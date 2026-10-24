/**
 * Display order and labels for program kinds (major, minor, and special
 * programs such as Honors College). Kinds not listed here sort last and are
 * labeled from their name, so adding a kind to the catalog schema needs no UI
 * changes.
 */
const KINDS: Record<string, { order: number; singular: string; plural: string }> = {
  major: { order: 0, singular: "Major", plural: "Majors" },
  minor: { order: 1, singular: "Minor", plural: "Minors" },
  program: { order: 2, singular: "Special program", plural: "Programs" },
};

export function kindOrder(kind: string): number {
  return KINDS[kind]?.order ?? Object.keys(KINDS).length;
}

export function kindLabel(kind: string, plural = false): string {
  const known = KINDS[kind];
  if (known) return plural ? known.plural : known.singular;
  const name = kind.charAt(0).toUpperCase() + kind.slice(1);
  return plural ? `${name}s` : name;
}

/** The distinct kinds among some programs, in display order. */
export function kindsIn(programs: { kind: string }[]): string[] {
  return [...new Set(programs.map((p) => p.kind))].sort((a, b) => kindOrder(a) - kindOrder(b));
}
