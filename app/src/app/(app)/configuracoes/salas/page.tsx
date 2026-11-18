import { asc, eq } from "drizzle-orm";
import { RoomEditor } from "@/components/agenda/room-editor";
import { Form, Submit } from "@/components/form";
import { PageHeader } from "@/components/ui";
import { type RoomHours } from "@/lib/agenda";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { cn } from "@/lib/utils";
import { addRoom, toggleRoom } from "@/server/actions/settings";

export const metadata = { title: "Salas · Configurações" };

const ABBR = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function hoursSummary(hours: RoomHours | null) {
  if (!hours) return "Horário padrão da agenda";
  const parts: string[] = [];
  for (let d = 0; d < 7; d++) {
    const day = hours[String(d)];
    if (day) parts.push(`${ABBR[d]} ${day.open}–${day.close}`);
  }
  return parts.length ? parts.join(" · ") : "Fechada";
}

export default async function RoomsSettingsPage() {
  const ctx = await getContext();
  const rooms = await db
    .select({ id: schema.rooms.id, name: schema.rooms.name, active: schema.rooms.active, hours: schema.rooms.hours })
    .from(schema.rooms)
    .where(eq(schema.rooms.companyId, ctx.companyId))
    .orderBy(asc(schema.rooms.name));

  return (
    <>
      <PageHeader title="Salas da agenda" subtitle="Salas e sua carga horária por dia da semana" />
      <section className="card max-w-2xl p-5">
        {rooms.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma sala cadastrada ainda.</p>
        ) : (
          <div className="divide-y divide-line">
            {rooms.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-3 first:pt-0">
                <div className="min-w-0 flex-1">
                  <div className={cn("font-medium", !r.active && "text-muted line-through")}>{r.name}</div>
                  <div className="truncate text-xs text-muted">{hoursSummary(r.hours)}</div>
                </div>
                <RoomEditor room={r} />
                <form action={toggleRoom.bind(null, r.id, !r.active)}>
                  <button className="btn-ghost px-2 py-1 text-xs">{r.active ? "Desativar" : "Ativar"}</button>
                </form>
              </div>
            ))}
          </div>
        )}
        <Form action={addRoom} className="mt-4">
          <div className="flex items-center gap-2">
            <input name="name" required placeholder="Nova sala (ex.: Estética 3)" className="input flex-1" />
            <Submit className="btn-secondary shrink-0">Adicionar</Submit>
          </div>
        </Form>
      </section>
    </>
  );
}
