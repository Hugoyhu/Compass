const DEGREE_SUFFIXES: Record<string, string> = {
  AA: "A.A.",
  AS: "A.S.",
  BA: "B.A.",
  BE: "B.E.",
  BAS: "B.A.S.",
  BFA: "B.F.A.",
  BS: "B.S.",
  MA: "M.A.",
  MFA: "M.F.A.",
  MS: "M.S.",
  PHD: "Ph.D.",
};

/** Formats catalog names such as "Computer Science, BS" for display. */
export function formatProgramName(name: string): string {
  const match = name.match(/^(.*?),\s*([A-Za-z]+)$/);
  if (!match) return name;

  const degree = DEGREE_SUFFIXES[match[2].toUpperCase()];
  return degree ? `${degree} ${match[1]}` : name;
}
