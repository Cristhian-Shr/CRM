import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Ctx } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { contactScope, listMembers } from "@/lib/db/tenant";
import type { SessionOpt } from "@/components/agenda/appointment-form";

/** Listas usadas pelos formulários de agendamento. */
export async function agendaOptions(ctx: Ctx, contactId?: string) {
  const [contacts, procedures, members, rooms, sessions] = await Promise.all([
    db
      .select({ id: schema.contacts.id, name: schema.contacts.name })
      .from(schema.contacts)
      .where(and(contactScope(ctx), contactId ? eq(schema.contacts.id, contactId) : undefined))
      .orderBy(asc(schema.contacts.name))
      .limit(1000),
    db
      .select({ id: schema.procedures.id, name: schema.procedures.name, durationMinutes: schema.procedures.durationMinutes })
      .from(schema.procedures)
      .where(and(eq(schema.procedures.companyId, ctx.companyId), eq(schema.procedures.active, true)))
      .orderBy(asc(schema.procedures.name)),
    listMembers(ctx.companyId),
    db
      .select({ id: schema.rooms.id, name: schema.rooms.name })
      .from(schema.rooms)
      .where(and(eq(schema.rooms.companyId, ctx.companyId), eq(schema.rooms.active, true)))
      .orderBy(asc(schema.rooms.name)),
    db
      .select({
        id: schema.contractedSessions.id,
        contactId: schema.contractedSessions.contactId,
        procedureId: schema.contractedSessions.procedureId,
        procedure: schema.procedures.name,
        program: schema.programs.name,
        remaining: sql<number>`(${schema.contractedSessions.sessionsTotal} - ${schema.contractedSessions.sessionsUsed}
          - (select count(*) from appointments a where a.contracted_session_id = ${schema.contractedSessions.id}
             and a.status not in ('done','cancelled','no_show')))::int`,
      })
      .from(schema.contractedSessions)
      .innerJoin(schema.procedures, eq(schema.procedures.id, schema.contractedSessions.procedureId))
      .leftJoin(schema.programs, eq(schema.programs.id, schema.contractedSessions.programId))
      .where(
        and(
          eq(schema.contractedSessions.companyId, ctx.companyId),
          contactId ? eq(schema.contractedSessions.contactId, contactId) : undefined,
          sql`${schema.contractedSessions.sessionsUsed} < ${schema.contractedSessions.sessionsTotal}`,
        ),
      ),
  ]);
  return {
    contacts,
    procedures,
    professionals: members.filter((m) => m.active && m.isProfessional).map((m) => ({ id: m.id, name: m.name })),
    members: members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name })),
    rooms,
    sessions: sessions.map<SessionOpt>((s) => ({
      id: s.id,
      contactId: s.contactId,
      procedureId: s.procedureId,
      remaining: s.remaining,
      label: s.program ? `${s.procedure} (${s.program})` : s.procedure,
    })),
  };
}
