import { Card } from "@/components/ui/card";
import { forwardRef, type ReactNode } from "react";

interface NexusEmptyStateProps {
  icon: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}

export const NexusEmptyState = forwardRef<HTMLDivElement, NexusEmptyStateProps>(function NexusEmptyState({
  icon,
  title,
  message,
  action,
}, ref) {
  return (
    <Card ref={ref} className="p-10 text-center bg-card/50 border-dashed">
      <div className="flex justify-center mb-3 text-muted-foreground">{icon}</div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground max-w-md mx-auto">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
});

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: "primary" | "success" | "warning" | "danger" | "muted";
}) {
  const toneCls =
    tone === "success"
      ? "text-primary"
      : tone === "warning"
      ? "text-yellow-500"
      : tone === "danger"
      ? "text-destructive"
      : tone === "muted"
      ? "text-muted-foreground"
      : "text-primary";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
        {icon && <span className={toneCls}>{icon}</span>}
        <span>{label}</span>
      </div>
      <p className="text-xl font-bold font-mono">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </Card>
  );
}

export function fmtNum(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

export function fmtPrice(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
