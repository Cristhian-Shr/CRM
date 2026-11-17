"use client";

import { useRouter, useSearchParams } from "next/navigation";

/** Data local (sem drift de fuso) no formato AAAA-MM-DD. */
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function PeriodPicker({ de, ate }: { de: string; ate: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const todas = sp.get("todas") ? "&todas=1" : "";
  const go = (d: string, a: string) => router.push(`?de=${d}&ate=${a}${todas}`);

  const presets: [string, () => void][] = [
    ["Hoje", () => { const t = new Date(); go(iso(t), iso(t)); }],
    ["Ontem", () => { const y = addDays(new Date(), -1); go(iso(y), iso(y)); }],
    ["7 dias", () => { const t = new Date(); go(iso(addDays(t, -6)), iso(t)); }],
    ["30 dias", () => { const t = new Date(); go(iso(addDays(t, -29)), iso(t)); }],
    ["Este mês", () => { const t = new Date(); go(iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)); }],
    ["Mês passado", () => {
      const t = new Date();
      go(iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0)));
    }],
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-xl border border-line text-sm">
        {presets.map(([label, fn]) => (
          <button key={label} type="button" onClick={fn} className="px-3 py-1.5 text-muted transition-colors hover:bg-brand-50">
            {label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-sm text-muted">
        De
        <input type="date" value={de} max={ate} onChange={(e) => e.target.value && go(e.target.value, ate)} className="input w-36" />
      </label>
      <label className="flex items-center gap-1 text-sm text-muted">
        Até
        <input type="date" value={ate} min={de} onChange={(e) => e.target.value && go(de, e.target.value)} className="input w-36" />
      </label>
    </div>
  );
}
