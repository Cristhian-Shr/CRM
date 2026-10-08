import "server-only";
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import type { Ctx } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db, schema, type Tx } from "./index";

type Executor = typeof db | Tx;

/** Filtro de contatos: empresa ativa + (colaborador vê só os seus, salvo liberação do admin). */
export function contactScope(ctx: Ctx): SQL {
  const base = and(eq(schema.contacts.companyId, ctx.companyId), isNull(schema.contacts.deletedAt))!;
  if (can(ctx, "leads.viewAll") || !ctx.memberId) return base;
  return and(base, eq(schema.contacts.ownerId, ctx.memberId))!;
}

export function dealScope(ctx: Ctx): SQL {
  const base = and(eq(schema.deals.companyId, ctx.companyId), isNull(schema.deals.deletedAt))!;
  if (can(ctx, "leads.viewAll") || !ctx.memberId) return base;
  return and(base, eq(schema.deals.ownerId, ctx.memberId))!;
}

export async function getContactOr404(ctx: Ctx, contactId: string) {
  const contact = await db.query.contacts.findFirst({
    where: and(contactScope(ctx), eq(schema.contacts.id, contactId)),
  });
  if (!contact) throw new Error("Cliente não encontrado.");
  return contact;
}

export async function listMembers(companyId: string) {
  return db
    .select({
      id: schema.companyMembers.id,
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.companyMembers.role,
      isSeller: schema.companyMembers.isSeller,
      isProfessional: schema.companyMembers.isProfessional,
      jobTitle: schema.companyMembers.jobTitle,
      color: schema.companyMembers.color,
      active: schema.companyMembers.active,
    })
    .from(schema.companyMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.companyMembers.userId))
    .where(eq(schema.companyMembers.companyId, companyId))
    .orderBy(asc(schema.users.name));
}

export async function listStages(companyId: string) {
  return db
    .select()
    .from(schema.pipelineStages)
    .where(eq(schema.pipelineStages.companyId, companyId))
    .orderBy(asc(schema.pipelineStages.position));
}

export async function logActivity(
  ex: Executor,
  ctx: Pick<Ctx, "companyId"> & { userId?: string | null },
  data: { contactId: string; dealId?: string | null; type: string; payload?: Record<string, unknown> },
) {
  await ex.insert(schema.activities).values({
    companyId: ctx.companyId,
    contactId: data.contactId,
    dealId: data.dealId ?? null,
    actorId: ctx.userId ?? null,
    type: data.type,
    payload: data.payload ?? {},
  });
}

export async function audit(
  ex: Executor,
  data: { companyId?: string | null; userId?: string | null; action: string; entity?: string; entityId?: string; metadata?: unknown },
) {
  await ex.insert(schema.auditLogs).values({
    companyId: data.companyId ?? null,
    userId: data.userId ?? null,
    action: data.action,
    entity: data.entity,
    entityId: data.entityId,
    metadata: data.metadata ?? null,
  });
}

/** Cria notificação para o usuário dono de um vínculo (company_member). */
export async function notifyMember(
  ex: Executor,
  companyId: string,
  memberId: string | null | undefined,
  n: { type: string; title: string; body?: string; link?: string },
) {
  if (!memberId) return;
  const m = await ex.query.companyMembers.findFirst({ where: eq(schema.companyMembers.id, memberId) });
  if (!m) return;
  await ex.insert(schema.notifications).values({ companyId, userId: m.userId, ...n });
}
