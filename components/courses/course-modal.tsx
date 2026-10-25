"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/**
 * The courses opened since the list, in history order, and which one is showing.
 * Module state so it survives the modal re-rendering for each course.
 */
const trail = {
  paths: [] as string[],
  at: 0,
  resetTimer: undefined as ReturnType<typeof setTimeout> | undefined,
};

function visit(pathname: string) {
  clearTimeout(trail.resetTimer);
  const { paths, at } = trail;
  if (paths.length === 0) {
    trail.paths = [pathname];
    trail.at = 0;
  } else if (paths[at] === pathname) {
    // Already here.
  } else if (paths[at - 1] === pathname) {
    trail.at = at - 1;
  } else if (paths[at + 1] === pathname) {
    trail.at = at + 1;
  } else {
    trail.paths = [...paths.slice(0, at + 1), pathname];
    trail.at = at + 1;
  }
}

/**
 * A course opened from the Course Explorer list, shown over it. Courses opened
 * from inside it stack up with back / forward; closing leaves them all behind.
 */
export function CourseModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, rerender] = useState(0);

  useEffect(() => {
    visit(pathname);
    rerender((n) => n + 1);
  }, [pathname]);

  // Forget the trail once the modal has really gone, not just remounted for the next course.
  useEffect(
    () => () => {
      trail.resetTimer = setTimeout(() => {
        trail.paths = [];
        trail.at = 0;
      }, 100);
    },
    [],
  );

  const canBack = trail.at > 0;
  const canForward = trail.at < trail.paths.length - 1;

  function close() {
    // Every course shown sits on top of the list in history; step back past all of them.
    window.history.go(-(trail.at + 1));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90vh] gap-6 overflow-y-auto p-6 sm:max-w-5xl">
        <div className="-mb-2 flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!canBack}
            onClick={() => router.back()}
            aria-label="Back"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!canForward}
            onClick={() => router.forward()}
            aria-label="Forward"
          >
            <ChevronRight />
          </Button>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
