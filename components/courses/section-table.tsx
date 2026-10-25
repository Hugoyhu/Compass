import type { Section } from "@/lib/domain/catalog/offering";
import { instructorNames } from "@/lib/engine/professors";
import type { InstructorRating } from "@/lib/services/schedule";

/** Scheduled sections as a table; tutorials (independent study and similar) are only counted. */
export function SectionTable({ sections, ratings }: { sections: Section[]; ratings: Record<string, InstructorRating> }) {
  const tutorials = sections.filter((s) => s.component === "TUT");
  const classes = sections.filter((s) => s.component !== "TUT");
  return (
    <div className="space-y-2">
      {classes.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Section</th>
                <th className="px-3 py-1.5 font-medium">Days</th>
                <th className="px-3 py-1.5 font-medium">Time</th>
                <th className="px-3 py-1.5 font-medium">Room</th>
                <th className="px-3 py-1.5 font-medium">Instructor</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {classes.map((s) =>
                (s.meetings.length > 0 ? s.meetings : [null]).map((m, i) => (
                  <tr key={`${s.classNumber}-${i}`} className={s.campus === "korea" ? "text-muted-foreground" : undefined}>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {i === 0 && (
                        <>
                          {s.component} {s.section}
                          {s.campus === "korea" && " · SUNY Korea"}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{m?.days ?? "TBA"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{m && m.start ? `${m.start}–${m.end}` : "TBA"}</td>
                    <td className="px-3 py-1.5">{m?.room || "TBA"}</td>
                    <td className="px-3 py-1.5">
                      {m?.instructor ? (
                        <Instructors text={m.instructor} ratings={ratings} />
                      ) : (
                        "TBA"
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
      {tutorials.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {tutorials.length} tutorial {tutorials.length === 1 ? "section" : "sections"}, arranged with an instructor
        </p>
      )}
    </div>
  );
}

/** Instructor names, each followed by a link to their Rate My Professors score when one matched. */
function Instructors({ text, ratings }: { text: string; ratings: Record<string, InstructorRating> }) {
  const names = instructorNames(text);
  if (names.length === 0) return <>{text}</>;
  return (
    <>
      {names.map((name, i) => {
        const r = ratings[name];
        return (
          <span key={name}>
            {i > 0 && ", "}
            {name}
            {r && (
              <a
                href={`https://www.ratemyprofessors.com/professor/${r.id}`}
                target="_blank"
                rel="noreferrer"
                title={`Rate My Professors: ${r.rating.toFixed(1)}/5 from ${r.numRatings} ${r.numRatings === 1 ? "rating" : "ratings"}, difficulty ${r.difficulty.toFixed(1)}`}
                className="ml-1.5 tabular-nums text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                ★ {r.rating.toFixed(1)}
              </a>
            )}
          </span>
        );
      })}
    </>
  );
}
