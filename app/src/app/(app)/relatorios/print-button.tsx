"use client";

import { Printer } from "lucide-react";

/** Dispara a impressão do navegador (permite salvar como PDF). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-secondary print:hidden">
      <Printer className="size-4" />
      Imprimir
    </button>
  );
}
