import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTerm } from "@/lib/domain/terms";
import type { CourseAttempt, TermId } from "@/lib/domain/types";

export function CurrentTermCard({
  term,
  courses,
}: {
  term: TermId;
  courses: { attempt: CourseAttempt; title: string; credits: number }[];
}) {
  const credits = courses.reduce((sum, c) => sum + c.credits, 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>This semester</CardTitle>
        <CardDescription>
          {formatTerm(term)} · {courses.length} {courses.length === 1 ? "course" : "courses"} · {credits} credits in
          progress
        </CardDescription>
      </CardHeader>
      <CardContent>
        {courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No in-progress courses recorded.</p>
        ) : (
          <ul className="divide-y">
            {courses.map(({ attempt, title, credits }) => (
              <li key={attempt.code} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0 truncate">
                  <span className="font-mono text-xs text-muted-foreground">{attempt.code}</span> {title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{credits} cr</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
