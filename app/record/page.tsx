import type { Metadata } from "next";
import { Suspense } from "react";
import { RecordEditor } from "@/components/record/record-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { getEditorOptions } from "@/lib/services/dashboard";
import { getStudentRecord } from "@/lib/student/store";

export const metadata: Metadata = { title: "My Courses" };

export default function RecordPage() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">My courses</h2>
        <p className="text-sm text-muted-foreground">
          Courses you&apos;ve completed or are taking, plus AP and transfer credit. Saved to your account when you&apos;re
          signed in, otherwise in this browser.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Editor />
      </Suspense>
    </main>
  );
}

async function Editor() {
  const [record, options] = await Promise.all([getStudentRecord(), getEditorOptions()]);
  return <RecordEditor record={record} courses={options.courses} programs={options.programs} />;
}
