"use client";

import { useRouter, useSearchParams } from "next/navigation";

const PERIODS: [string, string][] = [
  ["hoje", "Hoje"],
  ["7", "Últimos 7 dias"],
  ["14", "Últimos 14 dias"],
  ["30", "Últimos 30 dias"],
  ["mes", "Este mês"],
  ["custom", "Personalizado"],
];

export function TrafegoFilters({
  contas,
  campanhas,
}: {
  contas: { id: string; name: string }[];
  campanhas: { id: string; name: string }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.push(`/campanhas?${next.toString()}`);
  };
  const val = (k: string, d = "") => sp.get(k) ?? d;

  return (
    <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Período
        <select className="input w-44" value={val("periodo", "30")} onChange={(e) => set("periodo", e.target.value)}>
          {PERIODS.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        De
        <input type="date" className="input w-40" value={val("de")} onChange={(e) => { set("de", e.target.value); }} onBlur={() => set("periodo", "custom")} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Até
        <input type="date" className="input w-40" value={val("ate")} onChange={(e) => set("ate", e.target.value)} onBlur={() => set("periodo", "custom")} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Conta
        <select className="input w-52" value={val("conta")} onChange={(e) => set("conta", e.target.value)}>
          <option value="">Todas as contas</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Campanha
        <select className="input w-56" value={val("campanha")} onChange={(e) => set("campanha", e.target.value)}>
          <option value="">Todas as campanhas</option>
          {campanhas.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
