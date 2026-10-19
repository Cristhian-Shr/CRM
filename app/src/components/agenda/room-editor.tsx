"use client";

import { Pencil } from "lucide-react";
import { Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { WEEKDAYS, type RoomHours } from "@/lib/agenda";
import { updateRoom } from "@/server/actions/settings";

export type RoomRow = { id: string; name: string; hours: RoomHours | null };

/** Dias úteis pré-marcados (Seg–Sex) quando a sala ainda não tem horário definido. */
const DEFAULT_OPEN = new Set([1, 2, 3, 4, 5]);

/** Modal para editar nome e carga horária (por dia da semana) de uma sala. */
export function RoomEditor({ room }: { room: RoomRow }) {
  return (
    <Modal title={`Editar sala · ${room.name}`} trigger={<Pencil className="size-4" aria-label="Editar" />} triggerClassName="btn-ghost p-1.5">
      <Form action={updateRoom.bind(null, room.id)} resetOnSuccess={false}>
        <label className="block">
          <span className="label">Nome</span>
          <input name="name" required defaultValue={room.name} className="input" />
        </label>

        <div className="space-y-2">
          <span className="label">Carga horária</span>
          {WEEKDAYS.map((label, d) => {
            const day = room.hours?.[String(d)];
            const checked = room.hours ? !!day : DEFAULT_OPEN.has(d);
            return (
              <div key={d} className="flex items-center gap-2">
                <label className="flex w-28 items-center gap-2 text-sm">
                  <input type="checkbox" name={`open_${d}`} defaultChecked={checked} className="accent-brand-500" />
                  {label}
                </label>
                <input type="time" name={`start_${d}`} defaultValue={day?.open ?? "08:00"} className="input w-32" />
                <span className="text-muted">às</span>
                <input type="time" name={`end_${d}`} defaultValue={day?.close ?? "18:00"} className="input w-32" />
              </div>
            );
          })}
          <p className="text-xs text-muted">Dias desmarcados ficam fechados. Sem nenhum dia marcado, a sala usa o horário padrão da agenda.</p>
        </div>

        <Submit>Salvar</Submit>
      </Form>
    </Modal>
  );
}
