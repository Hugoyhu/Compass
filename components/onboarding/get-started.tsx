import Link from "next/link";
import { FileUp, NotebookPen, UserRound } from "lucide-react";
import { loadSampleRecord } from "@/app/actions/record";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function GetStarted() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Plan your Stony Brook degree</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Compass checks your coursework against your major&apos;s requirements, catches grade and prerequisite
          problems, and proposes what to take next. Start by adding your courses.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <FileUp className="size-5 text-primary" aria-hidden />
            <CardTitle>Upload your transcript</CardTitle>
            <CardDescription>
              Upload the unofficial transcript PDF from SOLAR. You review every course before anything is saved.
            </CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto">
            <Link href="/record#upload" className={buttonVariants()}>
              Upload transcript
            </Link>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <NotebookPen className="size-5 text-primary" aria-hidden />
            <CardTitle>Add courses yourself</CardTitle>
            <CardDescription>Enter courses, grades, and AP or transfer credit by hand.</CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto">
            <Link href="/record" className={buttonVariants({ variant: "outline" })}>
              Add courses
            </Link>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <UserRound className="size-5 text-primary" aria-hidden />
            <CardTitle>Explore with a sample student</CardTitle>
            <CardDescription>
              A fictional Computer Science junior, including a grade problem for Compass to catch.
            </CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto">
            <form action={loadSampleRecord}>
              <Button type="submit" variant="outline">
                Load sample student
              </Button>
            </form>
          </CardFooter>
        </Card>
      </div>
      <Card size="sm" className="bg-muted/40">
        <CardContent className="text-xs text-muted-foreground">
          Without an account, your record is stored only in this browser. Create an account (just a username and
          password) to keep it across devices. Transcript uploads are sent to Anthropic&apos;s API to read the course
          list; the file isn&apos;t kept.
        </CardContent>
      </Card>
    </div>
  );
}
