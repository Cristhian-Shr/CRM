import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn, initials } from "@/lib/utils";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  delta,
  tone = "brand",
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  hint?: ReactNode;
  delta?: number | null;
  tone?: "brand" | "green" | "red" | "amber";
}) {
  const tones = {
    brand: "text-brand-500",
    green: "text-green-600",
    red: "text-red-600",
    amber: "text-amber-600",
  };
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium tracking-[0.12em] text-muted uppercase">{label}</span>
        <Icon className={cn("size-5", tones[tone])} />
      </div>
      <div className="mt-3 font-display text-2xl font-bold md:text-3xl">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {delta != null && (
          <span className={cn("font-semibold", delta >= 0 ? "text-green-600" : "text-red-600")}>
            {delta >= 0 ? "+" : ""}
            {delta}%
          </span>
        )}
        {hint}
      </div>
    </div>
  );
}

export function Avatar({ name, color, size = "md" }: { name: string; color?: string | null; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        size === "sm" ? "size-6 text-[10px]" : "size-9 text-xs",
      )}
      style={{ background: color ?? "#be5574" }}
    >
      {initials(name)}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">{children}</div>;
}

export function Dot({ color }: { color: string }) {
  return <span className="inline-block size-2 rounded-full" style={{ background: color }} />;
}

export const CONTACT_STATUS: Record<string, { label: string; cls: string }> = {
  lead: { label: "Lead", cls: "bg-indigo-50 text-indigo-700" },
  client: { label: "Cliente", cls: "bg-green-50 text-green-700" },
  inactive: { label: "Inativo", cls: "bg-zinc-100 text-zinc-600" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = CONTACT_STATUS[status] ?? CONTACT_STATUS.lead;
  return <span className={cn("badge", s.cls)}>{s.label}</span>;
}

export function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return cur ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}
