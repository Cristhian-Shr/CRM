"use server";

import { and, eq, gt, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getContactOr404, logActivity } from "@/lib/db/tenant";
import { STATUS_LABEL } from "@/lib/agenda";
import { fmtDateTime, str, zonedToUtc } from "@/lib/utils";
import { safe } from "../safe";

const { appointments, contractedSessions, procedures } = schema;
const INACTIVE = ["cancelled", "no_show"];


function revalidateAgenda(contactId?: string) {
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  if (contactId) revalidatePath(`/clientes/${contactId}`);
}

async function parseAppointment(fd: FormData, companyId: string) {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.").parse(str(fd, "date"));
  const time = z.string().regex(/^\d{2}:\d{2}$/, "Informe o horário.").parse(str(fd, "time"));
  const procedureId = str(fd, "procedureId");
  const proc = procedureId
    ? await db.query.procedures.findFirst({ where: and(eq(procedures.id, procedureId), eq(procedures.companyId, companyId)) })
    : null;
  const duration = Number(str(fd, "duration")) || proc?.durationMinutes || 60;
  const startsAt = zonedToUtc(`${date}T${time}`);
  return {
    contactId: z.string().uuid("Escolha o cliente.").parse(str(fd, "contactId")),
    procedureId: proc?.id ?? null,
    contractedSessionId: str(fd, "contractedSessionId"),
    professionalId: str(fd, "professionalId"),
    roomId: str(fd, "roomId"),
    type: str(fd, "type") ?? "procedure",
    notes: str(fd, "notes"),
    startsAt,
    endsAt: new Date(startsAt.getTime() + duration * 60_000),
  };
}

/** Impede dois atendimentos no mesmo horário com a mesma sala ou profissional. */
async function assertNoConflict(companyId: string, a: { startsAt: Date; endsAt: Date; roomId: string | null; professionalId: string | null }, ignoreId?: string) {
  if (!a.roomId && !a.professionalId) return;
  const clash = await db.query.appointments.findFirst({
    where: and(
      eq(appointments.companyId, companyId),
      notInArray(appointments.status, INACTIVE),
      lt(appointments.startsAt, a.endsAt),
      gt(appointments.endsAt, a.startsAt),
      ignoreId ? ne(appointments.id, ignoreId) : undefined,
      or(
        a.roomId ? eq(appointments.roomId, a.roomId) : undefined,
        a.professionalId ? eq(appointments.professionalId, a.professionalId) : undefined,
      ),
    ),
  });
  if (clash) throw new Error(`Conflito de horário com outro atendimento às ${fmtDateTime(clash.startsAt)} (mesma sala ou profissional).`);
}

/** Confere saldo do programa: sessões usadas + agendadas não podem passar do contratado. */
async function assertBalance(companyId: string, contactId: string, sessionId: string | null, ignoreId?: string) {
  if (!sessionId) return null;
  const s = await db.query.contractedSessions.findFirst({
    where: and(eq(contractedSessions.id, sessionId), eq(contractedSessions.companyId, companyId), eq(contractedSessions.contactId, contactId)),
  });
  if (!s) throw new Error("Saldo de sessões não encontrado para este cliente.");
  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.contractedSessionId, sessionId),
        notInArray(appointments.status, [...INACTIVE, "done"]),
        ignoreId ? ne(appointments.id, ignoreId) : undefined,
      ),
    );
  if (s.sessionsUsed + pending >= s.sessionsTotal) throw new Error("Todas as sessões deste procedimento já foram usadas ou agendadas.");
  return s;
}

export async function createAppointment(fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    const a = await parseAppointment(fd, ctx.companyId);
    await getContactOr404(ctx, a.contactId);
    const session = await assertBalance(ctx.companyId, a.contactId, a.contractedSessionId);
    if (session && !a.procedureId) a.procedureId = session.procedureId;
    await assertNoConflict(ctx.companyId, a);
    const [appt] = await db
      .insert(appointments)
      .values({ ...a, companyId: ctx.companyId, createdBy: ctx.userId })
      .returning();
    const proc = a.procedureId ? await db.query.procedures.findFirst({ where: eq(procedures.id, a.procedureId) }) : null;
    await logActivity(db, ctx, {
      contactId: a.contactId,
      type: "appointment_created",
      payload: { when: fmtDateTime(a.startsAt), procedure: proc?.name ?? "Atendimento" },
    });
    await db.update(schema.contacts).set({ lastInteractionAt: new Date() }).where(eq(schema.contacts.id, a.contactId));
    revalidateAgenda(a.contactId);
    return { ok: true, id: appt.id };
  });
}

export async function updateAppointment(id: string, fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    const current = await db.query.appointments.findFirst({ where: and(eq(appointments.id, id), eq(appointments.companyId, ctx.companyId)) });
    if (!current) throw new Error("Agendamento não encontrado.");
    const a = await parseAppointment(fd, ctx.companyId);
    if (a.contractedSessionId !== current.contractedSessionId) await assertBalance(ctx.companyId, a.contactId, a.contractedSessionId, id);
    await assertNoConflict(ctx.companyId, a, id);
    await db.update(appointments).set({ ...a, updatedAt: new Date() }).where(eq(appointments.id, id));
    await logActivity(db, ctx, { contactId: a.contactId, type: "appointment_status", payload: { status: "Remarcado", when: fmtDateTime(a.startsAt) } });
    revalidateAgenda(a.contactId);
  });
}

/** Mudar status. Ao marcar "atendido" desconta uma sessão do saldo; ao desfazer, devolve. */
export async function setAppointmentStatus(id: string, status: string) {
  return safe(async () => {
    const ctx = await getContext();
    if (!STATUS_LABEL[status]) throw new Error("Status inválido.");
    const appt = await db.query.appointments.findFirst({ where: and(eq(appointments.id, id), eq(appointments.companyId, ctx.companyId)) });
    if (!appt) throw new Error("Agendamento não encontrado.");
    if (appt.status === status) return;
    await db.transaction(async (tx) => {
      await tx.update(appointments).set({ status, updatedAt: new Date() }).where(eq(appointments.id, id));
      if (appt.contractedSessionId) {
        const delta = status === "done" ? 1 : appt.status === "done" ? -1 : 0;
        if (delta) {
          await tx
            .update(contractedSessions)
            .set({ sessionsUsed: sql`greatest(0, ${contractedSessions.sessionsUsed} + ${delta})` })
            .where(eq(contractedSessions.id, appt.contractedSessionId));
        }
      }
      await logActivity(tx, ctx, {
        contactId: appt.contactId,
        type: "appointment_status",
        payload: { status: STATUS_LABEL[status], when: fmtDateTime(appt.startsAt) },
      });
    });
    revalidateAgenda(appt.contactId);
  });
}
