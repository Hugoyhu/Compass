import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { ProgressMeter } from "@/components/audit/progress-meter";
import { StatusBadge } from "@/components/audit/status-badge";
import type { RequirementResult } from "@/lib/engine/audit";
import { describeRemaining, itemNumber, progressFractions } from "@/lib/engine/describe";

export interface ProgramRequirements {
  programId: string;
  name: string;
  results: RequirementResult[];
}

/** Every requirement of every program, one bar each. */
export function RequirementsOverview({ programs }: { programs: ProgramRequirements[] }) {
  return (
    <div className="space-y-10">
      {programs.map((program) => (
        <section key={program.programId} aria-label={program.name}>
          <div className="flex items-baseline justify-between gap-4 border-b-2 border-foreground pb-2">
            <h3 className="text-base font-bold tracking-tight">{program.name}</h3>
            <Link href={`/progress?program=${program.programId}`} className="text-sm text-muted-foreground hover:text-foreground">
              Details →
            </Link>
          </div>
          <ul>
            {program.results.map((result) => (
              <Row key={result.requirement.id} result={result} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ result }: { result: RequirementResult }) {
  const { completed, inProgress } = progressFractions(result);
  const number = itemNumber(result.requirement.label);
  return (
    <li className="grid grid-cols-12 items-baseline gap-x-6 gap-y-2 border-b py-3">
      <div className="col-span-12 space-y-1 md:col-span-5">
        <p className="font-medium">
          {number && <span className="mr-2 text-muted-foreground tabular-nums">{number}</span>}
          {result.requirement.title}
        </p>
        {result.status !== "satisfied" && <p className="text-sm text-muted-foreground">{describeRemaining(result)}</p>}
        {result.issues.map((issue) => (
          <p key={issue} className="flex items-start gap-1.5 text-sm">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-status-critical" aria-hidden />
            <span>
              <span className="sr-only">Problem: </span>
              {issue}
            </span>
          </p>
        ))}
      </div>
      <div className="col-span-7 self-center md:col-span-4">
        <ProgressMeter completed={completed} inProgress={inProgress} label={`${result.requirement.title} progress`} />
      </div>
      <p className="col-span-2 self-center text-right text-sm tabular-nums md:col-span-1">
        {result.completed}
        {result.inProgress > 0 && <span className="text-primary">+{result.inProgress}</span>}/{result.required}
      </p>
      <div className="col-span-3 self-center justify-self-end md:col-span-2">
        <StatusBadge status={result.status} />
      </div>
    </li>
  );
}
