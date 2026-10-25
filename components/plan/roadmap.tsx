import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { AlternativePicker } from "@/components/plan/alternative-picker";
import { SeatPicker } from "@/components/plan/seat-picker";
import { StatusBadge } from "@/components/audit/status-badge";
import { slugFor } from "@/lib/domain/course-slug";
import { formatTerm } from "@/lib/domain/terms";
import type {
  Roadmap,
  RoadmapCourse,
  RoadmapProgram,
  RoadmapSlot,
} from "@/lib/engine/roadmap";
import { formatProgramName } from "@/lib/domain/program-name";

/** Everything left to graduate, program by program: specific courses, elective slots, and the rest. */
export function RoadmapView({ roadmap }: { roadmap: Roadmap }) {
  const { credits, terms } = roadmap;
  const toGo =
    credits.planned +
    credits.needed +
    credits.slots +
    credits.sbc +
    credits.free;
  const courses = new Set([
    ...roadmap.programs.flatMap((p) =>
      p.requirements.flatMap((r) => r.courses.map((c) => c.code)),
    ),
    ...roadmap.prerequisites.map((c) => c.code),
  ]);
  const slots = roadmap.programs
    .flatMap((p) => p.requirements.flatMap((r) => r.slots))
    .reduce((s, x) => s + x.count, 0);

  return (
    <div className="space-y-10">
      <p className="text-xl text-muted-foreground">
        Semester {Math.min(terms.used, terms.total)} of {terms.total} ·{" "}
        {terms.remaining.length} left
        {terms.remaining.length > 0 &&
          ` · about ${terms.perTerm} credits a semester`}
      </p>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y-2 border-foreground py-5 md:grid-cols-5">
        <Stat label="Credits to go" value={toGo} />
        <Stat label="Specific courses" value={courses.size} />
        <Stat label="Elective slots" value={slots} />
        <Stat label="SBC courses" value={roadmap.sbc.length} />
        <Stat label="Free electives" value={`${credits.free} cr`} />
      </dl>

      {roadmap.late.length > 0 && (
        <div
          role="alert"
          className="space-y-2 border-l-4 border-status-critical py-1 pl-4"
        >
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert
              className="size-4 text-status-critical"
              aria-hidden
            />
            Not everything fits in {terms.total} semesters
          </p>
          <ul className="space-y-1 text-sm">
            {roadmap.late.map((l) => (
              <li key={l.code}>
                <span className="font-mono">{l.chain.join(" → ")}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {l.code} can&apos;t start before {formatTerm(l.earliest)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {roadmap.programs.map((p) => (
        <ProgramSection key={p.id} program={p} />
      ))}

      {(roadmap.prerequisites.length > 0 ||
        roadmap.sbc.length > 0 ||
        credits.free > 0 ||
        roadmap.upperDivision.short > 0) && (
        <section aria-label="Everything else">
          <SectionHeading title="Everything else" />
          <ul>
            {roadmap.prerequisites.length > 0 && (
              <Row title="Prerequisites">
                <CourseList courses={roadmap.prerequisites} />
              </Row>
            )}
            {roadmap.sbc.length > 0 && (
              <Row title="Stony Brook Curriculum">
                <ul className="space-y-1.5">
                  {roadmap.sbc.map((s) => (
                    <SlotLine
                      key={s.code}
                      label={`${s.code} course`}
                      detail={s.name}
                      credits={3}
                    />
                  ))}
                </ul>
              </Row>
            )}
            {credits.free > 0 && (
              <Row title="Free electives">
                <ul>
                  <SlotLine
                    label="Any course"
                    detail="Credits still short of the degree total"
                    credits={credits.free}
                  />
                </ul>
              </Row>
            )}
            {roadmap.upperDivision.short > 0 && (
              <Row title="Upper division">
                <p className="text-sm text-muted-foreground">
                  {roadmap.upperDivision.short} more credits must be 300-level
                  or above.
                </p>
              </Row>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="space-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-bold tracking-tight tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function SectionHeading({
  title,
  aside,
}: {
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b-2 border-foreground pb-2">
      <h3 className="text-base font-bold tracking-tight">{title}</h3>
      {aside && (
        <span className="text-sm text-muted-foreground tabular-nums">
          {aside}
        </span>
      )}
    </div>
  );
}

function ProgramSection({ program }: { program: RoadmapProgram }) {
  return (
    <section aria-label={formatProgramName(program.name)}>
      <SectionHeading
        title={formatProgramName(program.name)}
        aside={
          <>
            {program.done}/{program.total} done · {program.creditsLeft} cr left
            ·{" "}
            <Link
              href={`/progress?program=${program.id}`}
              className="hover:text-foreground"
            >
              Details →
            </Link>
          </>
        }
      />
      {program.requirements.length === 0 ? (
        <p className="border-b py-3 text-sm text-muted-foreground">
          Nothing left once current courses finish.
        </p>
      ) : (
        <ul>
          {program.requirements.map((r) => (
            <Row key={r.id} title={r.heading} status={r.status}>
              {r.alternatives.map((group, i) => (
                <AlternativePicker key={i} alternatives={group} />
              ))}
              {r.seats.map((seat) => (
                <SeatPicker key={seat.selected.code} seat={seat} />
              ))}
              {r.courses.some(
                (c) => !r.seats.some((seat) => seat.selected.code === c.code),
              ) && (
                <CourseList
                  courses={r.courses.filter(
                    (c) =>
                      !r.seats.some((seat) => seat.selected.code === c.code),
                  )}
                />
              )}
              {r.slots.length > 0 && (
                <ul className="space-y-1.5">
                  {r.slots.map((s, i) => (
                    <Slot key={i} slot={s} />
                  ))}
                </ul>
              )}
              {r.coveredSlots.length > 0 && (
                <ul className="space-y-1.5">
                  {r.coveredSlots.map((c, k) => (
                    <Slot key={k} slot={c} inPlan />
                  ))}
                </ul>
              )}
              {r.review.map((text) => (
                <p key={text} className="text-sm text-muted-foreground">
                  Advisor review: {text}
                </p>
              ))}
            </Row>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({
  title,
  status,
  children,
}: {
  title: string;
  status?: RoadmapProgram["requirements"][number]["status"];
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-12 gap-x-6 gap-y-2 border-b py-3">
      <div className="col-span-12 space-y-1 md:col-span-4">
        <p className="font-medium">{title}</p>
        {status && <StatusBadge status={status} />}
      </div>
      <div className="col-span-12 space-y-3 md:col-span-8">{children}</div>
    </li>
  );
}

function CourseList({ courses }: { courses: RoadmapCourse[] }) {
  return (
    <ul className="space-y-1.5">
      {courses.map((c) => (
        <li
          key={c.code}
          className="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-x-3 text-sm"
        >
          <Link
            href={`/courses/${slugFor(c.code)}`}
            className="font-mono underline-offset-4 hover:underline"
          >
            {c.code}
          </Link>
          <span className="min-w-0">
            <span className="block truncate">{c.title}</span>
            <span className="block text-xs text-muted-foreground">
              {courseNote(c)}
            </span>
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {c.credits} cr
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Planned · Fall 2027", "Spring only · from Spring 2028", "Prerequisite for CSE 300". */
function courseNote(c: RoadmapCourse): string {
  const parts: string[] = [];
  if (c.state === "planned" && c.term)
    parts.push(`Planned · ${formatTerm(c.term)}`);
  if (c.reason) parts.push(c.reason);
  if (c.seasons?.length === 1) parts.push(`${c.seasons[0]} only`);
  if (c.seasons?.length === 0) parts.push("Not offered recently");
  if (c.state === "needed" && c.earliest)
    parts.push(`from ${formatTerm(c.earliest)}`);
  return parts.join(" · ");
}

function Slot({
  slot,
  inPlan = false,
}: {
  slot: RoadmapSlot;
  inPlan?: boolean;
}) {
  if (slot.absorbed >= slot.credits) {
    return (
      <SlotLine
        label="Covered by electives you take for another program"
        detail={`from ${slot.pool} · ${slot.sharesWith.join(", ")} electives count here too`}
        credits={slot.credits}
      />
    );
  }
  // Credits another program's electives cover here need no slot of their own.
  const count = Math.ceil((slot.credits - slot.absorbed) / 3);
  const label = count === 1 ? "1 elective" : `${count} electives`;
  const detail = [
    slot.option
      ? `from the ${slot.option.label} ${slot.option.kind}${slot.option.declared ? "" : " (closest match; none chosen yet)"}`
      : `from ${slot.options?.length ? slot.options.join(", ") : slot.pool}`,
    slot.absorbed > 0
      ? `plus ${slot.absorbed} credits from your ${slot.sharesWith.join(", ")} electives`
      : slot.lent > 0 &&
        `${slot.lent} credits can also count toward ${slot.sharesWith.join(", ")}`,
  ]

    .filter(Boolean)
    .join(" · ");
  return (
    <SlotLine
      label={label}
      detail={detail}
      credits={slot.credits - slot.absorbed}
    />
  );
}

/** A placeholder: a course to pick later, drawn with a dashed outline. */
function SlotLine({
  label,
  detail,
  credits,
}: {
  label: string;
  detail: string;
  credits: number;
}) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border border-dashed border-foreground/40 px-2.5 py-1.5 text-sm">
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {credits} cr
      </span>
    </li>
  );
}
