import { Badge } from "@/components/ui/badge";
import type { CourseStatus } from "@/lib/services/courses";
import { cn } from "@/lib/utils";

export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = {
  taken: "Taken",
  "in-progress": "In progress",
  planned: "Planned",
  "can-take": "Can take",
  "prereqs-missing": "Prereqs missing",
};

const STYLES: Record<CourseStatus, string> = {
  taken: "text-muted-foreground",
  "in-progress": "text-muted-foreground",
  planned: "text-muted-foreground",
  "can-take": "border-status-good/40 text-status-good",
  "prereqs-missing": "text-muted-foreground/70",
};

export function CourseStatusBadge({ status, className }: { status: CourseStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-normal", STYLES[status], className)}>
      {COURSE_STATUS_LABELS[status]}
    </Badge>
  );
}
