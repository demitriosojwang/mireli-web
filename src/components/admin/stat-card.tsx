import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad" | "info";
}) {
  // Tones are translucent tints so the cards sit correctly on the dark workspace.
  const tones: Record<string, string> = {
    default: "",
    good: "border-emerald-400/25 bg-emerald-400/[0.07]",
    warn: "border-amber-400/25 bg-amber-400/[0.07]",
    bad: "border-red-400/25 bg-red-400/[0.07]",
    info: "border-teal-400/25 bg-teal-400/[0.07]",
  };
  return (
    <Card className={cn(tones[tone])}>
      <CardContent className="p-4 sm:p-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums sm:text-[28px]">{value}</p>
        {sub && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
