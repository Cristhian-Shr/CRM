"use server";

import { and, asc, eq, gte, isNull, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { audit, dealScope, getContactOr404, logActivity, notifyMember } from "@/lib/db/tenant";
import { assertCan } from "@/lib/permissions";
import { normalizePhone, parseMoney, str } from "@/lib/utils";
import { safe } from "../safe";

const { contacts, deals, pipelineStages } = schema;

function revalidateLeads(contactId?: string) {
  revalidatePath("/funil");
  revalidatePath("/clientes");
  revalidatePath("/dashboard");
  if (contactId) revalidatePath(`/clientes/${contactId}`);
}

async function firstOpenStage(companyId: string) {
  const stage = await db.query.pipelineStages.findFirst({
    where: and(eq(pipelineStages.companyId, companyId), eq(pipelineStages.kind, "open")),
    orderBy: [asc(pipelineStages.position)],
  });
  if (!stage) throw new Error("Cadastre ao menos uma etapa no funil.");
  return stage;
}

/** Cria a ficha do cliente e a oportunidade no funil juntas. */
export async function createLead(fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    const name = z.string().min(2, "Informe o nome.").parse(str(fd, "name"));
    const email = z.string().email("E-mail inválido.").optional().parse(str(fd, "email") ?? undefined);
    const phone = normalizePhone(str(fd, "phone"));
    if (phone) {
      const dup = await db.query.contacts.findFirst({
        where: and(eq(contacts.companyId, ctx.companyId), eq(contacts.phone, phone), isNull(contacts.deletedAt)),
      });
      if (dup) return { error: `Já existe um cadastro com este telefone: ${dup.name}.` };
    }
    const ownerId = str(fd, "ownerId") ?? ctx.memberId;
    const stageId = str(fd, "stageId") ?? (await firstOpenStage(ctx.companyId)).id;

    const contactId = await db.transaction(async (tx) => {
      const [contact] = await tx
        .insert(contacts)
        .values({
          companyId: ctx.companyId,
          name,
          phone,
          whatsapp: phone,
          email: email ?? null,
          companyName: str(fd, "companyName"),
          ownerId,
          sourceId: str(fd, "sourceId"),
          notes: str(fd, "notes"),
          createdBy: ctx.userId,
          lastInteractionAt: new Date(),
        })
        .returning();
      const [{ pos }] = await tx
        .select({ pos: max(deals.position) })
        .from(deals)
        .where(and(eq(deals.companyId, ctx.companyId), eq(deals.stageId, stageId)));
      const [deal] = await tx
        .insert(deals)
        .values({
          companyId: ctx.companyId,
          contactId: contact.id,
          stageId,
          ownerId,
          title: str(fd, "title") ?? `Oportunidade · ${name}`,
          valueCents: parseMoney(str(fd, "value")),
          position: (pos ?? 0) + 1,
        })
        .returning();
      await tx.insert(schema.dealStageHistory).values({ companyId: ctx.companyId, dealId: deal.id, toStage: stageId, changedBy: ctx.userId });
      await logActivity(tx, ctx, { contactId: contact.id, dealId: deal.id, type: "lead_created", payload: { name } });
      if (ownerId && ownerId !== ctx.memberId) {
        await notifyMember(tx, ctx.companyId, ownerId, {
          type: "new_lead",
          title: "Novo lead para você",
          body: name,
          link: `/clientes/${contact.id}`,
        });
      }
      return contact.id;
    });
    revalidateLeads();
    return { ok: true, id: contactId };
  });
}

export async function updateContact(contactId: string, fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    const before = await getContactOr404(ctx, contactId);
    const name = z.string().min(2, "Informe o nome.").parse(str(fd, "name"));
    const email = z.string().email("E-mail inválido.").optional().parse(str(fd, "email") ?? undefined);
    const ownerId = str(fd, "ownerId");
    const tags = (str(fd, "tags") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await db
      .update(contacts)
      .set({
        name,
        phone: normalizePhone(str(fd, "phone")),
        whatsapp: normalizePhone(str(fd, "whatsapp") ?? str(fd, "phone")),
        email: email ?? null,
        companyName: str(fd, "companyName"),
        cpf: str(fd, "cpf"),
        birthDate: str(fd, "birthDate"),
        status: str(fd, "status") ?? before.status,
        ownerId,
        sourceId: str(fd, "sourceId"),
        tags,
        notes: str(fd, "notes"),
        consentAt: fd.get("consent") ? (before.consentAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(and(eq(contacts.id, contactId), eq(contacts.companyId, ctx.companyId)));
    if (ownerId !== before.ownerId) {
      await logActivity(db, ctx, { contactId, type: "owner_changed", payload: { from: before.ownerId, to: ownerId } });
      await notifyMember(db, ctx.companyId, ownerId, {
        type: "new_lead",
        title: "Lead transferido para você",
        body: name,
        link: `/clientes/${contactId}`,
      });
    }
    revalidateLeads(contactId);
  });
}

export async function deleteContact(contactId: string) {
  const ctx = await getContext();
  assertCan(ctx, "leads.delete");
  const now = new Date();
  await db.update(contacts).set({ deletedAt: now }).where(and(eq(contacts.id, contactId), eq(contacts.companyId, ctx.companyId)));
  await db.update(deals).set({ deletedAt: now }).where(and(eq(deals.contactId, contactId), eq(deals.companyId, ctx.companyId)));
  await audit(db, { companyId: ctx.companyId, userId: ctx.userId, action: "contact.delete", entity: "contact", entityId: contactId });
  revalidateLeads();
}

export async function createDeal(contactId: string, fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    const contact = await getContactOr404(ctx, contactId);
    const stageId = str(fd, "stageId") ?? (await firstOpenStage(ctx.companyId)).id;
    const [deal] = await db
      .insert(deals)
      .values({
        companyId: ctx.companyId,
        contactId,
        stageId,
        ownerId: contact.ownerId ?? ctx.memberId,
        title: z.string().min(2, "Informe um título.").parse(str(fd, "title")),
        valueCents: parseMoney(str(fd, "value")),
        expectedCloseDate: str(fd, "expectedCloseDate"),
      })
      .returning();
    await db.insert(schema.dealStageHistory).values({ companyId: ctx.companyId, dealId: deal.id, toStage: stageId, changedBy: ctx.userId });
    await logActivity(db, ctx, { contactId, dealId: deal.id, type: "deal_created", payload: { title: deal.title } });
    revalidateLeads(contactId);
  });
}

export async function updateDeal(dealId: string, fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    const deal = await db.query.deals.findFirst({ where: and(dealScope(ctx), eq(deals.id, dealId)) });
    if (!deal) throw new Error("Oportunidade não encontrada.");
    await db
      .update(deals)
      .set({
        title: str(fd, "title") ?? deal.title,
        valueCents: parseMoney(str(fd, "value")),
        ownerId: str(fd, "ownerId") ?? deal.ownerId,
        expectedCloseDate: str(fd, "expectedCloseDate"),
        updatedAt: new Date(),
      })
      .where(eq(deals.id, dealId));
    revalidateLeads(deal.contactId);
  });
}

/** Move o card no kanban. Regras: ganho → cliente; perdido → exige motivo. */
export async function moveDeal(input: { dealId: string; stageId: string; index: number; lossReasonId?: string; lossNote?: string }) {
  return safe(async () => {
    const ctx = await getContext();
    const deal = await db.query.deals.findFirst({ where: and(dealScope(ctx), eq(deals.id, input.dealId)) });
    if (!deal) throw new Error("Oportunidade não encontrada.");
    const stage = await db.query.pipelineStages.findFirst({
      where: and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.companyId, ctx.companyId)),
    });
    if (!stage) throw new Error("Etapa inválida.");
    const changed = stage.id !== deal.stageId;
    if (changed && stage.kind === "lost" && !input.lossReasonId) return { error: "Informe o motivo da perda." };

    await db.transaction(async (tx) => {
      // abre espaço na coluna de destino
      await tx
        .update(deals)
        .set({ position: sql`${deals.position} + 1` })
        .where(and(eq(deals.companyId, ctx.companyId), eq(deals.stageId, stage.id), gte(deals.position, input.index), sql`${deals.id} <> ${deal.id}`));
      await tx
        .update(deals)
        .set({
          stageId: stage.id,
          position: input.index,
          updatedAt: new Date(),
          ...(changed
            ? {
                stageEnteredAt: new Date(),
                wonAt: stage.kind === "won" ? new Date() : null,
                lostAt: stage.kind === "lost" ? new Date() : null,
                lossReasonId: stage.kind === "lost" ? input.lossReasonId : null,
                lossNote: stage.kind === "lost" ? (input.lossNote ?? null) : null,
              }
            : {}),
        })
        .where(eq(deals.id, deal.id));
      if (!changed) return;
      await tx
        .insert(schema.dealStageHistory)
        .values({ companyId: ctx.companyId, dealId: deal.id, fromStage: deal.stageId, toStage: stage.id, changedBy: ctx.userId });
      const from = await tx.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, deal.stageId) });
      await logActivity(tx, ctx, {
        contactId: deal.contactId,
        dealId: deal.id,
        type: "stage_changed",
        payload: { from: from?.name, to: stage.name, title: deal.title },
      });
      if (stage.kind === "won") {
        await tx.update(contacts).set({ status: "client", updatedAt: new Date() }).where(eq(contacts.id, deal.contactId));
      }
    });
    revalidateLeads(deal.contactId);
    return { ok: true, id: stage.kind === "won" ? deal.contactId : undefined };
  });
}

export async function addNote(contactId: string, fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    await getContactOr404(ctx, contactId);
    const text = z.string().min(1, "Escreva a anotação.").parse(str(fd, "text"));
    const kind = str(fd, "kind") === "call" ? "call" : "note";
    await logActivity(db, ctx, { contactId, type: kind, payload: { text } });
    await db.update(contacts).set({ lastInteractionAt: new Date() }).where(eq(contacts.id, contactId));
    revalidatePath(`/clientes/${contactId}`);
  });
}

