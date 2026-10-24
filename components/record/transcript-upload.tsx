"use client";

import { useRef, useState, useTransition } from "react";
import { FileUp, Loader2, TriangleAlert } from "lucide-react";
import { extractTranscriptAction } from "@/app/actions/transcript";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTerm } from "@/lib/domain/terms";
import type { CourseAttempt } from "@/lib/domain/types";
import type { TranscriptDraft } from "@/lib/transcript/extract";
import { groupAttempts } from "./options";

export interface ReviewedTranscript {
  draft: TranscriptDraft;
  attempts: CourseAttempt[];
  mode: "replace" | "merge";
}

export function TranscriptUpload({ hasCourses, onApply }: { hasCourses: boolean; onApply: (result: ReviewedTranscript) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TranscriptDraft | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  function upload(file: File) {
    setError(null);
    setDraft(null);
    const formData = new FormData();
    formData.set("transcript", file);
    startTransition(async () => {
      const result = await extractTranscriptAction(formData);
      if (result.ok) {
        setDraft(result.draft);
        setExcluded(new Set());
      } else {
        setError(result.error);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function apply(mode: ReviewedTranscript["mode"]) {
    if (!draft) return;
    onApply({ draft, attempts: draft.attempts.filter((_, i) => !excluded.has(i)), mode });
    setDraft(null);
  }

  if (draft) {
    const included = draft.attempts.length - excluded.size;
    return (
      <Card id="upload">
        <CardHeader>
          <CardTitle>Review courses</CardTitle>
          <CardDescription>
            {draft.attempts.length} courses
            {draft.plan ? ` · ${draft.plan}` : ""}
            {draft.currentTerm ? ` · ${formatTerm(draft.currentTerm)}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft.warnings.length > 0 && (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Check these</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {draft.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {groupAttempts(draft.attempts).map((group) => (
            <div key={group.key} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
              <ul className="divide-y rounded-lg border">
                {group.items.map(({ attempt, index }) => (
                  <li key={index}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm has-[:not(:checked)]:opacity-50">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={!excluded.has(index)}
                        onChange={(e) => {
                          const next = new Set(excluded);
                          if (e.target.checked) next.delete(index);
                          else next.add(index);
                          setExcluded(next);
                        }}
                      />
                      <span className="w-20 shrink-0 font-mono text-xs">{attempt.code}</span>
                      <span className="min-w-0 flex-1 truncate">{attempt.title}</span>
                      {attempt.sbc?.map((tag) => (
                        <Badge key={tag} variant="outline" className="hidden font-normal sm:inline-flex">
                          {tag}
                        </Badge>
                      ))}
                      <span className="w-14 shrink-0 text-right text-xs tabular-nums">{attempt.credits ?? "–"} cr</span>
                      <span className="w-20 shrink-0 text-right text-xs">
                        {attempt.status === "in-progress" ? "In progress" : (attempt.grade ?? "No grade")}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
        <CardFooter className="flex-wrap gap-2 py-3">
          <Button onClick={() => apply("replace")} disabled={included === 0}>
            {hasCourses ? `Replace my courses (${included})` : `Save ${included} courses`}
          </Button>
          {hasCourses && (
            <Button variant="outline" onClick={() => apply("merge")} disabled={included === 0}>
              Add to my courses
            </Button>
          )}
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card id="upload" size="sm">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <FileUp className="size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-medium">Upload a transcript</p>
          <p className="text-xs text-muted-foreground">SOLAR unofficial transcript (PDF). Not stored.</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          id="transcript-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={pending} className="shrink-0">
          {pending ? (
            <>
              <Loader2 className="animate-spin" />
              Reading…
            </>
          ) : (
            "Choose PDF"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
