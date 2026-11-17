"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";

/** Abre o diálogo de impressão automaticamente e oferece um botão manual. */
export function PrintTrigger() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-primary no-print fixed right-6 top-6 inline-flex items-center gap-2 px-4 py-2"
    >
      <Printer size={16} /> Imprimir / Salvar PDF
    </button>
  );
}
