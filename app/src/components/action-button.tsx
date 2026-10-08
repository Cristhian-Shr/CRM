"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/server/safe";

/** Botão que chama uma Server Action sem formulário e mostra o erro, se houver. */
export function ActionButton({ action, children, className = "btn-secondary", confirm: ask }: { action: () => Promise<ActionResult>; children: ReactNode; className?: string; confirm?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        className={className}
        disabled={pending}
        onClick={() => {
          if (ask && !window.confirm(ask)) return;
          setError(null);
          start(async () => {
            const r = await action();
            if (r?.error) setError(r.error);
          });
        }}
      >
        {pending ? "Aguarde..." : children}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-red-600">{error}</span>}
    </span>
  );
}
