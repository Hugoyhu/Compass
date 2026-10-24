import Link from "next/link";
import { FileUp, NotebookPen } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function GetStarted() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-5xl font-bold tracking-tight md:text-6xl">Add your courses</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <FileUp className="size-5 text-primary" aria-hidden />
            <CardTitle>Upload a transcript</CardTitle>
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
            <CardTitle>Enter them yourself</CardTitle>
          </CardHeader>
          <CardFooter className="mt-auto">
            <Link href="/record" className={buttonVariants({ variant: "outline" })}>
              Add courses
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
