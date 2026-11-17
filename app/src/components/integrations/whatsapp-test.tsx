"use client";

import { useState, useTransition } from "react";
import { testWhatsapp } from "@/server/actions/settings";

/** Botão que valida a conexão de WhatsApp salva (número, token e template) na hora. */
export function WhatsappTest({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok?: boolean; error?: string; label?: string } | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-ghost text-sm"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            setResult(null);
            const r = await testWhatsapp();
            setResult({ ok: r?.ok, error: r?.error, label: r?.id });
          })
        }
      >
        {pending ? "Testando…" : "Testar conexão"}
      </button>
      {result?.ok && <span className="text-sm text-green-600">✓ Conectado{result.label ? ` — ${result.label}` : ""}</span>}
      {result?.error && <span className="text-sm text-red-600">{result.error}</span>}
    </div>
  );
}
