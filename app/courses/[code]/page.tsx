import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { CourseDetailView } from "@/components/courses/course-detail-view";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { codeFromSlug } from "@/lib/domain/course-slug";

/** Thousands of courses render on first visit instead of at build time. */
export async function generateStaticParams() {
  return [{ code: "CSE-214" }];
}

export async function generateMetadata({ params }: PageProps<"/courses/[code]">): Promise<Metadata> {
  return { title: codeFromSlug((await params).code) };
}

export default function CoursePage({ params }: PageProps<"/courses/[code]">) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-10 px-4 py-8 md:px-8 md:py-12">
      <Link href="/courses" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}>
        <ArrowLeft />
        All courses
      </Link>
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <Course params={params} />
      </Suspense>
    </main>
  );
}

async function Course({ params }: Pick<PageProps<"/courses/[code]">, "params">) {
  return <CourseDetailView code={codeFromSlug((await params).code)} />;
}
