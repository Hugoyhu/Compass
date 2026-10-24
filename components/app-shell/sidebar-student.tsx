import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data/repository";
import { getStudentRecord } from "@/lib/student/store";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

/** Sidebar footer showing whose record is loaded. Reads cookies: render inside <Suspense>. */
export async function SidebarStudent() {
  const [record, user] = await Promise.all([getStudentRecord(), getCurrentUser()]);
  const programs = record ? await getRepository().listPrograms() : [];
  const major = programs.find((p) => record?.programIds.includes(p.id));
  const name = record?.name || user?.username || (record ? "Your record" : "No record yet");
  const displayName = record?.name || user?.username;
  const initials = displayName ? displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2) : "?";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" tooltip={name} render={<Link href="/record" />}>
          <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {initials}
          </div>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate font-medium">{name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {major?.name ?? (record ? "Choose a major" : "Add your courses")}
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Fixed-size placeholder (shadcn's SidebarMenuSkeleton uses Math.random, which breaks prerendering). */
export function SidebarStudentSkeleton() {
  return (
    <div className="flex h-12 items-center gap-2 px-2" aria-hidden>
      <Skeleton className="size-8 rounded-full" />
      <div className="flex-1 space-y-1.5 group-data-[collapsible=icon]:hidden">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2.5 w-32" />
      </div>
    </div>
  );
}
