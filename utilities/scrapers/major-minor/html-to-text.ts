/**
 * Converts a saved catalog program page to compact text for the model.
 *
 * Keeps what carries meaning (heading levels, list items, the "OR" items and
 * blank items that separate course groups, table columns) and drops page
 * chrome. Smaller input is cheaper and extracts more accurately.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function programHtmlToText(html: string): string {
  const start = html.indexOf("<h1");
  let body = start >= 0 ? html.slice(start) : html;

  body = body
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h([1-6])[^>]*>/gi, (_, level: string) => `\n${"#".repeat(Number(level))} `)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  const lines: string[] = [];
  for (const raw of decodeEntities(body).split("\n")) {
    const line = raw.replace(/[ \t ]+/g, " ").trim();
    // Course popups render as "Close" stubs after the program body; the footer follows.
    if (line === "Close") break;
    // Blank lines and bare cell separators come from layout markup, not content.
    if (line === "" || line === "|") continue;
    lines.push(line);
  }
  return lines.join("\n").trim();
}
