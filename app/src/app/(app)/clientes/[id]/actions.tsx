"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ActionResult } from "@/server/safe";
import { deleteContact } from "@/server/actions/leads";

export function DeleteContact({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="btn-ghost text-red-600"
      disabled={pending}
      onClick={() => {
        if (!confirm("Excluir este cadastro? Ele sai das listas, mas o histórico fica guardado.")) return;
        start(async () => {
          await deleteContact(id);
          router.push("/clientes");
        });
      }}
    >
      Excluir
    </button>
  );
}

export function OrderActions({
  id,
  draft,
  confirm: confirmAction,
  cancel,
}: {
  id: string;
  draft: boolean;
  confirm: (id: string) => Promise<ActionResult>;
  cancel: (id: string) => Promise<ActionResult>;
}) {
  const [pending, start] = useTransition();
  const run = (fn: (id: string) => Promise<ActionResult>, ask?: string) => {
    if (ask && !window.confirm(ask)) return;
    start(async () => {
      const r = await fn(id);
      if (r?.error) alert(r.error);
    });
  };
  return (
    <div className="mt-2 flex gap-2">
      {draft && (
        <button className="btn-secondary px-2 py-1 text-xs" disabled={pending} onClick={() => run(confirmAction)}>
          Confirmar venda
        </button>
      )}
      <button className="btn-ghost px-2 py-1 text-xs text-red-600" disabled={pending} onClick={() => run(cancel, "Cancelar esta comanda?")}>
        Cancelar
      </button>
    </div>
  );
}
