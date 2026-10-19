"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteContact } from "@/server/actions/leads";
import { EditContactModal, type EditableContact } from "./edit-contact";

type Opt = { id: string; name: string };

/** Ícones de editar e excluir para cada linha da lista de leads/clientes. */
export function LeadActions({
  contact,
  members,
  sources,
  canDelete,
}: {
  contact: EditableContact;
  members: Opt[];
  sources: Opt[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center justify-end gap-1">
      <EditContactModal
        contact={contact}
        members={members}
        sources={sources}
        triggerClassName="btn-ghost p-1.5"
        trigger={<Pencil className="size-4" aria-label="Editar" />}
      />
      {canDelete && (
        <button
          type="button"
          className="btn-ghost p-1.5 text-red-600"
          disabled={pending}
          aria-label="Excluir"
          onClick={() => {
            if (!confirm("Excluir este cadastro? Ele sai das listas, mas o histórico fica guardado.")) return;
            start(async () => {
              await deleteContact(contact.id);
              router.refresh();
            });
          }}
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  );
}
