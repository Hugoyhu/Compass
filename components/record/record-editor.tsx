"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import {
  clearRecord,
  loadSampleRecord,
  saveRecord,
} from "@/app/actions/record";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { kindLabel, kindsIn } from "@/lib/domain/program-kinds";
import { cn } from "@/lib/utils";
import {
  MAX_PROGRAMS,
  type CourseAttempt,
  type CreditSource,
  type Grade,
  type StudentRecord,
  type TermId,
} from "@/lib/domain/types";
import {
  DEFAULT_CURRENT_TERM,
  GRADE_OPTIONS,
  SOURCE_LABELS,
  TERM_OPTIONS,
  attemptKey,
  entryTermFor,
  groupAttempts,
  matchProgram,
  selectClassName,
  type CourseOption,
  type ProgramOption,
} from "./options";
import { TranscriptUpload, type ReviewedTranscript } from "./transcript-upload";

const EMPTY_RECORD: StudentRecord = {
  id: "browser",
  name: "",
  entryTerm: DEFAULT_CURRENT_TERM,
  currentTerm: DEFAULT_CURRENT_TERM,
  programIds: [],
  attempts: [],
  plan: [],
};

export function RecordEditor({
  record,
  courses,
  programs,
}: {
  record: StudentRecord | null;
  courses: CourseOption[];
  programs: ProgramOption[];
}) {
  const [draft, setDraft] = useState<StudentRecord>(record ?? EMPTY_RECORD);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const catalog = useMemo(
    () => new Map(courses.map((c) => [c.code, c])),
    [courses],
  );

  function update(next: Partial<StudentRecord>) {
    setDraft((d) => ({ ...d, ...next }));
    setDirty(true);
    setMessage(null);
  }

  function updateAttempt(index: number, patch: Partial<CourseAttempt>) {
    update({
      attempts: draft.attempts.map((a, i) =>
        i === index ? { ...a, ...patch } : a,
      ),
    });
  }

  function persist(next: StudentRecord) {
    const toSave = {
      ...next,
      entryTerm: entryTermFor(next.attempts, next.currentTerm),
    };
    startTransition(async () => {
      const result = await saveRecord(toSave);
      if (result.ok) {
        setDraft(toSave);
        setDirty(false);
        setMessage({ kind: "ok", text: "Saved" });
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  }

  function applyTranscript({
    draft: transcript,
    attempts,
    mode,
  }: ReviewedTranscript) {
    const existing = mode === "merge" ? draft.attempts : [];
    const seen = new Set(existing.map(attemptKey));
    const merged = [
      ...existing,
      ...attempts.filter((a) => !seen.has(attemptKey(a))),
    ];
    const programId = matchProgram(transcript.plan, programs);
    persist({
      ...draft,
      name: draft.name || transcript.studentName || "",
      currentTerm: transcript.currentTerm ?? draft.currentTerm,
      programIds:
        draft.programIds.length > 0
          ? draft.programIds
          : programId
            ? [programId]
            : [],
      attempts: merged,
    });
  }

  const programsById = new Map(programs.map((p) => [p.id, p]));
  const available = programs.filter((p) => !draft.programIds.includes(p.id));
  const totalCredits = draft.attempts
    .filter(
      (a) =>
        a.status === "completed" &&
        a.grade &&
        !["F", "NC", "W", "I"].includes(a.grade),
    )
    .reduce(
      (sum, a) => sum + (a.credits ?? catalog.get(a.code)?.credits ?? 0),
      0,
    );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <TranscriptUpload
          hasCourses={draft.attempts.length > 0}
          onApply={applyTranscript}
        />
        <Card>
          <CardHeader>
            <CardTitle>Courses</CardTitle>
            <CardDescription>{totalCredits} credits earned</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {draft.attempts.length === 0 && (
              <p className="text-sm text-muted-foreground">No courses yet.</p>
            )}
            {groupAttempts(draft.attempts).map((group) => (
              <section
                key={group.key}
                className="space-y-1.5"
                aria-label={group.label}
              >
                <h3 className="text-xs font-medium text-muted-foreground">
                  {group.label}
                </h3>
                <ul className="divide-y rounded-lg border">
                  {group.items.map(({ attempt, index }) => {
                    const known = catalog.get(attempt.code);
                    return (
                      <li
                        key={`${attemptKey(attempt)}-${index}`}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm"
                      >
                        <span className="w-20 shrink-0 font-mono text-xs">
                          {attempt.code}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {known?.title ?? attempt.title ?? "Unknown course"}
                        </span>
                        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {attempt.credits ?? known?.credits ?? "–"} cr
                        </span>
                        <select
                          aria-label={`Grade for ${attempt.code}`}
                          className={cn(selectClassName, "w-32 shrink-0")}
                          value={
                            attempt.status === "in-progress"
                              ? "in-progress"
                              : (attempt.grade ?? "")
                          }
                          onChange={(e) =>
                            e.target.value === "in-progress"
                              ? updateAttempt(index, {
                                  status: "in-progress",
                                  grade: undefined,
                                })
                              : updateAttempt(index, {
                                  status: "completed",
                                  grade: e.target.value as Grade,
                                })
                          }
                        >
                          {attempt.source === "sbu" && (
                            <option value="in-progress">In progress</option>
                          )}
                          {GRADE_OPTIONS.map((g) => (
                            <option key={g} value={g}>
                              {g === "T" ? "T (credit)" : g}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${attempt.code}`}
                          onClick={() =>
                            update({
                              attempts: draft.attempts.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <AddCourseForm
              courses={courses}
              currentTerm={draft.currentTerm}
              onAdd={(attempt) =>
                update({ attempts: [...draft.attempts, attempt] })
              }
            />
          </CardContent>
          <CardFooter className="flex-wrap items-center gap-3 border-t bg-muted/30 py-3">
            <Button onClick={() => persist(draft)} disabled={!dirty || pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save changes
            </Button>
            {message && (
              <p
                role="status"
                className={`text-sm ${message.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {message.text}
              </p>
            )}
          </CardFooter>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Name</span>
              <Input
                value={draft.name}
                maxLength={80}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <div className="space-y-1.5">
              <span className="text-xs font-medium">Programs</span>
              {draft.programIds.length > 0 && (
                <ul className="divide-y rounded-lg border text-sm">
                  {draft.programIds.map((id) => (
                    <li
                      key={id}
                      className="flex items-center gap-2 py-1 pr-1 pl-3"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {programsById.get(id)?.name ?? id}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {kindLabel(programsById.get(id)?.kind ?? "")}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${programsById.get(id)?.name ?? id}`}
                        onClick={() =>
                          update({
                            programIds: draft.programIds.filter(
                              (p) => p !== id,
                            ),
                          })
                        }
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {draft.programIds.length < MAX_PROGRAMS && (
                <select
                  aria-label="Add a program"
                  className={selectClassName}
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    update({
                      programIds: [...draft.programIds, e.target.value],
                    })
                  }
                >
                  <option value="">Add…</option>
                  {kindsIn(available).map((kind) => (
                    <optgroup key={kind} label={kindLabel(kind, true)}>
                      {available
                        .filter((p) => p.kind === kind)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Current term</span>
              <select
                className={selectClassName}
                value={draft.currentTerm}
                onChange={(e) =>
                  update({ currentTerm: e.target.value as TermId })
                }
              >
                {TERM_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </CardContent>
          <CardFooter className="border-t bg-muted/30 py-3">
            <Button
              size="sm"
              onClick={() => persist(draft)}
              disabled={!dirty || pending}
            >
              Save profile
            </Button>
          </CardFooter>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Start over</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <form action={loadSampleRecord}>
              <Button type="submit" variant="outline" size="sm">
                Load sample student
              </Button>
            </form>
            <form
              action={clearRecord}
              onSubmit={(e) => {
                if (!confirm("Delete all of your courses?")) e.preventDefault();
              }}
            >
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-destructive"
              >
                Delete all courses
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AddCourseForm({
  courses,
  currentTerm,
  onAdd,
}: {
  courses: CourseOption[];
  currentTerm: TermId;
  onAdd: (attempt: CourseAttempt) => void;
}) {
  const [code, setCode] = useState("");
  const [source, setSource] = useState<CreditSource>("sbu");
  const [term, setTerm] = useState<TermId>(currentTerm);
  const [grade, setGrade] = useState<string>("in-progress");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = code
      .toUpperCase()
      .replace(/^([A-Z]{3,4})\s*(\d{3}).*$/, "$1 $2");
    if (!/^[A-Z]{3,4} \d{3}$/.test(normalized)) {
      setError("Use a code like CSE 214.");
      return;
    }
    const known = courses.find((c) => c.code === normalized);
    const inProgress = source === "sbu" && grade === "in-progress";
    onAdd({
      code: normalized,
      source,
      ...(source === "sbu" && { term }),
      status: inProgress ? "in-progress" : "completed",
      ...(!inProgress && { grade: (source === "sbu" ? grade : "T") as Grade }),
      ...(known && { credits: known.credits }),
    });
    setCode("");
    setError(null);
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-lg border border-dashed p-3"
      aria-label="Add a course"
    >
      <p className="text-xs font-medium">Add a course</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
        <Input
          list="catalog-courses"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Course code"
          aria-label="Course code"
        />
        <datalist id="catalog-courses">
          {courses.map((c) => (
            <option key={c.code} value={c.code}>
              {c.title}
            </option>
          ))}
        </datalist>
        <select
          aria-label="Credit type"
          className={selectClassName}
          value={source}
          onChange={(e) => setSource(e.target.value as CreditSource)}
        >
          {(Object.keys(SOURCE_LABELS) as CreditSource[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Term"
          className={selectClassName}
          value={term}
          onChange={(e) => setTerm(e.target.value as TermId)}
          disabled={source !== "sbu"}
        >
          {TERM_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Grade"
          className={selectClassName}
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          disabled={source !== "sbu"}
        >
          <option value="in-progress">In progress</option>
          {GRADE_OPTIONS.filter((g) => g !== "T").map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          <Plus />
          Add
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
