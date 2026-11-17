"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { backfillMetaMonth } from "@/server/actions/campaigns";

const MAX_MONTHS = 37;

/** Importa o histórico mês a mês, mostrando progresso. Para após 2 meses vazios seguidos. */
export function BackfillButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    let empty = 0;
    try {
      for (let m = 0; m <= MAX_MONTHS; m++) {
        setProgress(`Importando… mês ${m + 1} de ${MAX_MONTHS + 1}`);
        const r = await backfillMetaMonth(m);
        if (r.error) {
          setError(r.error);
          break;
        }
        if (r.rows === 0) {
          empty++;
          if (empty >= 2) break;
        } else {
          empty = 0;
        }
        if (r.done) break;
      }
    } finally {
      setRunning(false);
      setProgress(null);
      router.refresh();
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" className="btn-secondary" disabled={running} onClick={run}>
        {running ? (progress ?? "Importando…") : "Importar histórico"}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-red-600">{error}</span>}
    </span>
  );
}
