import Link from "next/link";
import { ABAS } from "@/lib/trafego";
import { cn } from "@/lib/utils";

export function Tabs({ active, query }: { active: string; query: string }) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-xl bg-surface p-1 text-sm">
      {ABAS.map(([key, label]) => (
        <Link key={key} href={`/campanhas?aba=${key}${query}`} className={cn("rounded-lg px-3 py-1.5", active === key ? "bg-brand-500 text-white" : "text-muted hover:bg-brand-50")}>
          {label}
        </Link>
      ))}
    </div>
  );
}
