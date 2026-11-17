"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const GROUPS: [string, string][] = [
  ["day", "Dia"],
  ["week", "Semana"],
  ["month", "Mês"],
];

function ymd(dt: Date) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function parse(d: string) {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(y, m - 1, dd);
}
function weekRange(d: string) {
  const dt = parse(d);
  const dow = (dt.getDay() + 6) % 7; // segunda = 0
  const start = new Date(dt);
  start.setDate(dt.getDate() - dow);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: ymd(start), end: ymd(end) };
}
function monthRange(d: string) {
  const dt = parse(d);
  return {
    start: ymd(new Date(dt.getFullYear(), dt.getMonth(), 1)),
    end: ymd(new Date(dt.getFullYear(), dt.getMonth() + 1, 0)),
  };
}

/**
 * Filtros do relatório operacional: intervalo De/Até, agrupamento e atalhos.
 * `today` vem do servidor (fuso da clínica) para os atalhos não escorregarem de dia.
 */
export function ReportFilters({ from, to, group, today }: { from: string; to: string; group: string; today: string }) {
  const router = useRouter();

  function go(f: string, t: string, g: string) {
    router.push(`/relatorios?from=${f}&to=${t}&group=${g}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <label className="flex flex-col gap-1 text-xs text-muted">
        De
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => e.target.value && go(e.target.value, to, group)}
          className="input w-40"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Até
        <input
          type="date"
          value={to}
          min={from}
          onChange={(e) => e.target.value && go(from, e.target.value, group)}
          className="input w-40"
        />
      </label>

      <div className="flex flex-col gap-1 text-xs text-muted">
        Agrupar por
        <div className="flex overflow-hidden rounded-xl border border-line text-sm">
          {GROUPS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => go(from, to, key)}
              className={cn(
                "px-3 py-1.5 transition-colors",
                group === key ? "bg-brand-500 text-white" : "text-muted hover:bg-brand-50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted">
        Atalhos
        <div className="flex gap-2 text-sm">
          <button type="button" onClick={() => go(today, today, group)} className="btn-secondary px-3 py-1.5">
            Hoje
          </button>
          <button
            type="button"
            onClick={() => {
              const { start, end } = weekRange(today);
              go(start, end, group);
            }}
            className="btn-secondary px-3 py-1.5"
          >
            Esta semana
          </button>
          <button
            type="button"
            onClick={() => {
              const { start, end } = monthRange(today);
              go(start, end, group);
            }}
            className="btn-secondary px-3 py-1.5"
          >
            Este mês
          </button>
        </div>
      </div>

      <a
        href={`/relatorio-pdf?from=${from}&to=${to}&group=${group}`}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary ml-auto inline-flex items-center gap-2 px-4 py-2"
      >
        <Download size={16} /> Baixar PDF
      </a>
    </div>
  );
}
