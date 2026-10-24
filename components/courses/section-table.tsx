import type { Section } from "@/lib/domain/catalog/offering";

/** Scheduled sections as a table; tutorials (independent study and similar) are only counted. */
export function SectionTable({ sections }: { sections: Section[] }) {
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
                    <td className="px-3 py-1.5">{m?.instructor || "TBA"}</td>
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
