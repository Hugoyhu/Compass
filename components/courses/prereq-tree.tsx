import Link from "next/link";
import { Circle, CircleCheck, CircleDashed, Clock } from "lucide-react";
import type { Prereq } from "@/lib/domain/catalog/course";
import { slugFor } from "@/lib/domain/course-slug";
import type { CourseDetail } from "@/lib/services/courses";

type Courses = CourseDetail["prereqCourses"];

const STATE_ICONS = {
  done: { icon: CircleCheck, className: "text-status-good", label: "Taken" },
  "in-progress": { icon: Clock, className: "text-[#a86f00]", label: "In progress" },
  planned: { icon: CircleDashed, className: "text-muted-foreground", label: "Planned" },
  missing: { icon: Circle, className: "text-muted-foreground", label: "Not taken" },
} as const;

/** A prerequisite tree, with the student's progress on each course when known. */
export function PrereqTree({ prereq, courses }: { prereq: Prereq; courses: Courses }) {
  return <Node prereq={prereq} courses={courses} />;
}

function Node({ prereq, courses }: { prereq: Prereq; courses: Courses }) {
  switch (prereq.type) {
    case "course": {
      const info = courses[prereq.code];
      const state = info?.state ? STATE_ICONS[info.state] : null;
      return (
        <p className="flex items-baseline gap-2 text-sm">
          {state && <state.icon className={`size-3.5 shrink-0 translate-y-0.5 ${state.className}`} aria-label={state.label} />}
          <Link href={`/courses/${slugFor(prereq.code)}`} className="shrink-0 font-mono text-xs underline-offset-4 hover:underline">
            {prereq.code}
          </Link>
          <span className="min-w-0 truncate text-muted-foreground">{info?.title}</span>
          {(prereq.minGrade || prereq.concurrentAllowed) && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {[prereq.minGrade && `${prereq.minGrade} or higher`, prereq.concurrentAllowed && "may be taken together"].filter(Boolean).join(", ")}
            </span>
          )}
        </p>
      );
    }
    case "standing":
      return <p className="text-sm">{prereq.level} standing or higher</p>;
    case "program":
    case "permission":
    case "unparsed":
      return <p className="text-sm">{prereq.text}</p>;
    case "and":
    case "or":
      return (
        <div className="space-y-1.5 border-l-2 pl-3">
          <p className="text-xs font-medium">{prereq.type === "and" ? "All of" : "One of"}</p>
          {prereq.of.map((p, i) => (
            <Node key={i} prereq={p} courses={courses} />
          ))}
        </div>
      );
  }
}
