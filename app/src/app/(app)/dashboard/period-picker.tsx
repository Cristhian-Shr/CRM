"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS: [string, string][] = [
  ["dia", "Dia"],
  ["semana", "Semana"],
  ["mes", "Mês"],
];

/** Seletor de período do dashboard: Dia · Semana · Mês. */
export function PeriodPicker({ p, d, m }: { p: string; d: string; m: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-xl border border-line text-sm">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => router.push(`/dashboard?p=${key}`)}
            className={cn("px-3 py-1.5 transition-colors", p === key ? "bg-brand-500 text-white" : "text-muted hover:bg-brand-50")}
          >
            {label}
          </button>
        ))}
      </div>
      {p === "mes" ? (
        <input
          type="month"
          defaultValue={m}
          onChange={(e) => e.target.value && router.push(`/dashboard?p=mes&m=${e.target.value}`)}
          className="input w-40"
        />
      ) : (
        <input
          type="date"
          defaultValue={d}
          onChange={(e) => e.target.value && router.push(`/dashboard?p=${p}&d=${e.target.value}`)}
          className="input w-40"
        />
      )}
    </div>
  );
}
