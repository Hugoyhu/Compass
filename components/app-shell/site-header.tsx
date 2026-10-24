"use client";

import { usePathname } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { navItemFor } from "./nav";

export function SiteHeader({ sourceLabel, disclaimer }: { sourceLabel: string; disclaimer: string }) {
  const item = navItemFor(usePathname());

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-4 self-center" />
      <h1 className="text-sm font-medium">{item?.title ?? "Compass"}</h1>
      <div className="ml-auto">
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge variant="outline" className="cursor-help gap-1.5 border-status-warning/50 bg-status-warning/10 text-foreground">
                <FlaskConical />
                {sourceLabel}
              </Badge>
            }
          />
          <TooltipContent side="bottom" className="max-w-xs">
            {disclaimer}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
