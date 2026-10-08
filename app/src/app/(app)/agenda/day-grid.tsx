"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AppointmentForm, type ProcOpt, type SessionOpt } from "@/components/agenda/appointment-form";
import { Modal } from "@/components/modal";
import { Empty } from "@/components/ui";
import { APPOINTMENT_TYPES, STATUS_COLOR, STATUS_LABEL } from "@/lib/agenda";
import { cn, fmtTime, toLocalInput } from "@/lib/utils";
import { setAppointmentStatus } from "@/server/actions/agenda";

export type GridAppt = {
  id: string;
  contactId: string;
  contactName: string;
  procedureId: string | null;
  procedure: string | null;
  contractedSessionId: string | null;
  professionalId: string | null;
  roomId: string | null;
  type: string;
  startsAt: string;
  endsAt: string;
  status: string;
  notes: string | null;
};

type Opt = { id: string; name: string };
type Opts = { contacts: Opt[]; procedures: ProcOpt[]; professionals: Opt[]; rooms: Opt[]; sessions: SessionOpt[] };

const START_H = 7;
const END_H = 21;
const SLOT_PX = 28; // 15 minutos

function minutesOfDay(iso: string) {
  const [h, m] = toLocalInput(iso).slice(11).split(":").map(Number);
  return h * 60 + m;
}

export function DayGrid({ view, columns, appts, date, opts }: { view: string; columns: Opt[]; appts: GridAppt[]; date: string; opts: Opts }) {
  const [selected, setSelected] = useState<GridAppt | null>(null);
  const [newSlot, setNewSlot] = useState<{ time: string; col: string } | null>(null);

  const colOf = (a: GridAppt) => (view === "profissional" ? a.professionalId : a.roomId) ?? "none";
  const visible = columns.filter((c) => c.id !== "none" || appts.some((a) => colOf(a) === "none"));
  const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);

  return (
    <>
      {view === "lista" ? (
        appts.length === 0 ? (
          <Empty>Nenhum atendimento neste dia.</Empty>
        ) : (
          <div className="card divide-y divide-line">
            {appts.map((a) => (
              <button key={a.id} onClick={() => setSelected(a)} className="flex w-full items-center gap-4 p-3 text-left text-sm hover:bg-brand-50">
                <span className="w-24 font-semibold">
                  {fmtTime(a.startsAt)}–{fmtTime(a.endsAt)}
                </span>
                <span className="size-2.5 rounded-full" style={{ background: STATUS_COLOR[a.status] }} />
                <span className="flex-1 font-medium">{a.contactName}</span>
                <span className="text-muted">{a.procedure ?? APPOINTMENT_TYPES[a.type]}</span>
                <span className="w-28 text-right text-muted">{opts.rooms.find((r) => r.id === a.roomId)?.name ?? "—"}</span>
                <span className="w-28 text-right text-xs">{STATUS_LABEL[a.status]}</span>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="card overflow-x-auto">
          <div className="flex min-w-max">
            <div className="sticky left-0 z-10 w-16 shrink-0 border-r border-line bg-surface">
              <div className="h-10 border-b border-line" />
              {hours.map((h) => (
                <div key={h} className="border-b border-line pr-2 text-right text-xs text-muted" style={{ height: SLOT_PX * 4 }}>
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {visible.map((c) => (
              <div key={c.id} className="w-48 shrink-0 border-r border-line">
                <div className="flex h-10 items-center justify-center border-b border-line px-2 text-sm font-medium">{c.name}</div>
                <div className="relative" style={{ height: hours.length * SLOT_PX * 4 }}>
                  {hours.flatMap((h) =>
                    [0, 15, 30, 45].map((m) => (
                      <button
                        key={`${h}:${m}`}
                        className={cn("block w-full hover:bg-brand-50", m === 45 ? "border-b border-line" : "border-b border-dashed border-line/50")}
                        style={{ height: SLOT_PX }}
                        onClick={() => setNewSlot({ time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, col: c.id })}
                        aria-label={`Agendar ${h}:${m}`}
                      />
                    )),
                  )}
                  {appts
                    .filter((a) => colOf(a) === c.id)
                    .map((a) => {
                      const top = ((minutesOfDay(a.startsAt) - START_H * 60) / 15) * SLOT_PX;
                      const height = Math.max(SLOT_PX, ((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 900_000) * SLOT_PX - 2);
                      return (
                        <button
                          key={a.id}
                          onClick={() => setSelected(a)}
                          className={cn(
                            "absolute inset-x-1 overflow-hidden rounded-lg border-l-4 bg-surface px-2 py-1 text-left text-xs shadow-sm ring-1 ring-line hover:shadow-md",
                            a.status === "cancelled" && "opacity-50",
                          )}
                          style={{ top, height, borderLeftColor: STATUS_COLOR[a.status] }}
                        >
                          <div className="font-semibold">
                            {fmtTime(a.startsAt)}–{fmtTime(a.endsAt)}
                          </div>
                          <div className="truncate">{a.contactName}</div>
                          <div className="truncate text-muted">{a.procedure}</div>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal title="Novo agendamento" open={!!newSlot} onOpenChange={(o) => !o && setNewSlot(null)}>
        {newSlot && (
          <AppointmentForm
            {...opts}
            defaults={{
              date,
              time: newSlot.time,
              roomId: view === "sala" && newSlot.col !== "none" ? newSlot.col : null,
              professionalId: view === "profissional" && newSlot.col !== "none" ? newSlot.col : null,
            }}
          />
        )}
      </Modal>

      <Modal title={selected?.contactName ?? ""} open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        {selected && <ApptDetail appt={selected} opts={opts} onDone={() => setSelected(null)} />}
      </Modal>
    </>
  );
}

function ApptDetail({ appt, opts, onDone }: { appt: GridAppt; opts: Opts; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const local = toLocalInput(appt.startsAt);
  const duration = Math.round((new Date(appt.endsAt).getTime() - new Date(appt.startsAt).getTime()) / 60_000);

  if (editing)
    return (
      <AppointmentForm
        {...opts}
        sessions={opts.sessions}
        defaults={{
          id: appt.id,
          contactId: appt.contactId,
          procedureId: appt.procedureId,
          contractedSessionId: appt.contractedSessionId,
          professionalId: appt.professionalId,
          roomId: appt.roomId,
          type: appt.type,
          date: local.slice(0, 10),
          time: local.slice(11),
          duration,
          notes: appt.notes,
        }}
      />
    );

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="font-medium">
          {appt.procedure ?? APPOINTMENT_TYPES[appt.type]} · {fmtTime(appt.startsAt)}–{fmtTime(appt.endsAt)}
        </div>
        <div className="text-muted">
          {opts.rooms.find((r) => r.id === appt.roomId)?.name ?? "Sem sala"} · {opts.professionals.find((p) => p.id === appt.professionalId)?.name ?? "Sem profissional"}
        </div>
        {appt.contractedSessionId && <div className="mt-1 text-xs text-brand-600">Usa sessão do programa contratado</div>}
        {appt.notes && <p className="mt-2 rounded-xl bg-canvas p-2">{appt.notes}</p>}
      </div>
      <div>
        <div className="label">Status</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(STATUS_LABEL).map(([k, l]) => (
            <button
              key={k}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await setAppointmentStatus(appt.id, k);
                  if (r?.error) setError(r.error);
                  else onDone();
                })
              }
              className={cn("badge border px-3 py-1", appt.status === k ? "text-white" : "bg-surface")}
              style={appt.status === k ? { background: STATUS_COLOR[k], borderColor: STATUS_COLOR[k] } : { borderColor: STATUS_COLOR[k], color: STATUS_COLOR[k] }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-secondary" onClick={() => setEditing(true)}>
          Remarcar / editar
        </button>
        <Link href={`/clientes/${appt.contactId}`} className="btn-ghost">
          Abrir ficha
        </Link>
      </div>
    </div>
  );
}
