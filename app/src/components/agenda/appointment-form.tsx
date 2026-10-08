"use client";

import { useState } from "react";
import { Field, Form, Submit } from "@/components/form";
import { APPOINTMENT_TYPES } from "@/lib/agenda";
import { createAppointment, updateAppointment } from "@/server/actions/agenda";

type Opt = { id: string; name: string };
export type SessionOpt = { id: string; contactId: string; procedureId: string; label: string; remaining: number };
export type ProcOpt = Opt & { durationMinutes: number };
export type ApptDefaults = {
  id?: string;
  contactId?: string;
  procedureId?: string | null;
  contractedSessionId?: string | null;
  professionalId?: string | null;
  roomId?: string | null;
  type?: string;
  date?: string;
  time?: string;
  duration?: number;
  notes?: string | null;
};

export function AppointmentForm({
  contacts,
  procedures,
  professionals,
  rooms,
  sessions,
  defaults = {},
}: {
  contacts: Opt[];
  procedures: ProcOpt[];
  professionals: Opt[];
  rooms: Opt[];
  sessions: SessionOpt[];
  defaults?: ApptDefaults;
}) {
  const [contactId, setContactId] = useState(defaults.contactId ?? "");
  const [sessionId, setSessionId] = useState(defaults.contractedSessionId ?? "");
  const [procedureId, setProcedureId] = useState(defaults.procedureId ?? "");
  const [duration, setDuration] = useState(defaults.duration ?? 60);
  const available = sessions.filter((s) => s.contactId === contactId && (s.remaining > 0 || s.id === defaults.contractedSessionId));
  const action = defaults.id ? updateAppointment.bind(null, defaults.id) : createAppointment;

  return (
    <Form action={action}>
      <Field label="Cliente">
        <select name="contactId" required className="input" value={contactId} onChange={(e) => { setContactId(e.target.value); setSessionId(""); }}>
          <option value="">Selecione...</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {available.length > 0 && (
        <Field label="Sessão do programa contratado">
          <select
            name="contractedSessionId"
            className="input"
            value={sessionId}
            onChange={(e) => {
              setSessionId(e.target.value);
              const s = sessions.find((x) => x.id === e.target.value);
              if (s) {
                setProcedureId(s.procedureId);
                setDuration(procedures.find((p) => p.id === s.procedureId)?.durationMinutes ?? duration);
              }
            }}
          >
            <option value="">Avulso (não usar saldo)</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} · {s.remaining} restante(s)
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Procedimento">
          <select
            name="procedureId"
            className="input"
            value={procedureId}
            onChange={(e) => {
              setProcedureId(e.target.value);
              const p = procedures.find((x) => x.id === e.target.value);
              if (p) setDuration(p.durationMinutes);
            }}
          >
            <option value="">—</option>
            {procedures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tipo">
          <select name="type" className="input" defaultValue={defaults.type ?? "procedure"}>
            {Object.entries(APPOINTMENT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Data">
          <input name="date" type="date" required className="input" defaultValue={defaults.date} />
        </Field>
        <Field label="Horário">
          <input name="time" type="time" required step={300} className="input" defaultValue={defaults.time} />
        </Field>
        <Field label="Duração (min)">
          <input name="duration" type="number" min={5} step={5} className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Profissional">
          <select name="professionalId" className="input" defaultValue={defaults.professionalId ?? ""}>
            <option value="">—</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sala">
          <select name="roomId" className="input" defaultValue={defaults.roomId ?? ""}>
            <option value="">Sem sala</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Observações">
        <textarea name="notes" rows={2} className="input" defaultValue={defaults.notes ?? ""} />
      </Field>
      <Submit>{defaults.id ? "Salvar alterações" : "Agendar"}</Submit>
    </Form>
  );
}
