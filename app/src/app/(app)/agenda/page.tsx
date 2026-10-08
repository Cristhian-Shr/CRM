import { and, asc, eq, gte, lt } from "drizzle-orm";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { AutoSubmitInput } from "@/components/auto-submit";
import { AppointmentForm } from "@/components/agenda/appointment-form";
import { Modal } from "@/components/modal";
import { PageHeader } from "@/components/ui";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/agenda";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { cn, fmtDate, todayISO, ucfirst, zonedToUtc } from "@/lib/utils";
import { agendaOptions } from "@/server/options";
import { DayGrid, type GridAppt } from "./day-grid";

export const metadata = { title: "Agenda" };

function shift(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ data?: string; visao?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const date = sp.data && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) ? sp.data : todayISO();
  const view = sp.visao === "profissional" ? "profissional" : sp.visao === "lista" ? "lista" : "sala";
  const start = zonedToUtc(`${date}T00:00`);
  const end = zonedToUtc(`${shift(date, 1)}T00:00`);

  const [opts, rows] = await Promise.all([
    agendaOptions(ctx),
    db
      .select({
        id: schema.appointments.id,
        contactId: schema.appointments.contactId,
        contactName: schema.contacts.name,
        procedureId: schema.appointments.procedureId,
        procedure: schema.procedures.name,
        contractedSessionId: schema.appointments.contractedSessionId,
        professionalId: schema.appointments.professionalId,
        roomId: schema.appointments.roomId,
        type: schema.appointments.type,
        startsAt: schema.appointments.startsAt,
        endsAt: schema.appointments.endsAt,
        status: schema.appointments.status,
        notes: schema.appointments.notes,
      })
      .from(schema.appointments)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.appointments.contactId))
      .leftJoin(schema.procedures, eq(schema.procedures.id, schema.appointments.procedureId))
      .where(and(eq(schema.appointments.companyId, ctx.companyId), gte(schema.appointments.startsAt, start), lt(schema.appointments.startsAt, end)))
      .orderBy(asc(schema.appointments.startsAt)),
  ]);

  const appts: GridAppt[] = rows.map((r) => ({ ...r, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() }));
  const columns =
    view === "profissional"
      ? [...opts.professionals, { id: "none", name: "Sem profissional" }]
      : [...opts.rooms, { id: "none", name: "Sem sala" }];
  const link = (p: Record<string, string>) => `?${new URLSearchParams({ data: date, visao: view, ...p })}`;

  return (
    <>
      <PageHeader
        title="Agenda do dia"
        subtitle={<span>{ucfirst(fmtDate(start, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))} · {rows.length} atendimento(s)</span>}
        actions={
          <>
            <Link href={link({ data: shift(date, -1) })} className="btn-secondary p-2" aria-label="Dia anterior">
              <ChevronLeft className="size-4" />
            </Link>
            <form>
              <input type="hidden" name="visao" value={view} />
              <AutoSubmitInput type="date" name="data" defaultValue={date} className="input w-40" />
            </form>
            <Link href={link({ data: shift(date, 1) })} className="btn-secondary p-2" aria-label="Próximo dia">
              <ChevronRight className="size-4" />
            </Link>
            <Link href={link({ data: todayISO() })} className="btn-secondary">
              Hoje
            </Link>
            <div className="flex rounded-xl border border-line bg-surface p-1">
              {[
                ["sala", "Sala"],
                ["profissional", "Profissional"],
                ["lista", "Lista"],
              ].map(([k, l]) => (
                <Link key={k} href={link({ visao: k })} className={cn("rounded-lg px-3 py-1 text-sm", view === k ? "bg-brand-500 text-white" : "text-muted")}>
                  {l}
                </Link>
              ))}
            </div>
            <Modal title="Novo agendamento" trigger="+ Novo agendamento">
              <AppointmentForm {...opts} defaults={{ date }} />
            </Modal>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted">
        {Object.entries(STATUS_LABEL).map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: STATUS_COLOR[k] }} /> {l}
          </span>
        ))}
      </div>
      <DayGrid view={view} columns={columns} appts={appts} date={date} opts={opts} />
    </>
  );
}
