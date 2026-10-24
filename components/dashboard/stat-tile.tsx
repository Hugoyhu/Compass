import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function StatTile({
  label,
  value,
  detail,
  icon: Icon,
  children,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <Icon className="size-3.5" aria-hidden />
          {label}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tracking-tight tabular-nums group-data-[size=sm]/card:text-2xl">
          {value}
        </CardTitle>
      </CardHeader>
      {(detail || children) && (
        <CardContent className="space-y-2">
          {children}
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        </CardContent>
      )}
    </Card>
  );
}
