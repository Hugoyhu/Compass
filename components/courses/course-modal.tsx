"use client";

import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/** A course opened from the Course Explorer list; closing it goes back to the list. */
export function CourseModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Dialog open onOpenChange={(open) => !open && router.back()}>
      <DialogContent className="max-h-[90vh] gap-6 overflow-y-auto p-6 sm:max-w-5xl">{children}</DialogContent>
    </Dialog>
  );
}
