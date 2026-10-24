import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function StatTile({
  label,
  value,
  detail,
  children,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <CardDescription className="not-italic small-caps">{label}</CardDescription>
        <CardTitle className="text-3xl font-normal tabular-nums group-data-[size=sm]/card:text-3xl">{value}</CardTitle>
      </CardHeader>
      {(detail || children) && (
        <CardContent className="space-y-2">
          {children}
          {detail && <p className="text-xs text-muted-foreground italic">{detail}</p>}
        </CardContent>
      )}
    </Card>
  );
}
