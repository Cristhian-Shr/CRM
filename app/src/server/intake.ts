import "server-only";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logActivity, notifyMember } from "@/lib/db/tenant";

type Inbound = {
  name: string;
  phone: string | null;
  email?: string | null;
  sourceName: string;
  ownerId?: string | null;
  meta?: { leadId?: string; campaignId?: string; adsetId?: string; adId?: string };
};

/**
 * Entrada automática de lead (WhatsApp ou formulário da Meta).
 * Se o telefone já existe, devolve o contato. Se não, cria contato + oportunidade em "Novo Lead"
 * e avisa o responsável.
 */
export async function upsertInboundLead(companyId: string, data: Inbound) {
  if (data.phone) {
    const found = await db.query.contacts.findFirst({
      where: and(eq(schema.contacts.companyId, companyId), eq(schema.contacts.phone, data.phone), isNull(schema.contacts.deletedAt)),
    });
    if (found) return { contact: found, created: false };
  }

  let source = await db.query.leadSources.findFirst({
    where: and(eq(schema.leadSources.companyId, companyId), eq(schema.leadSources.name, data.sourceName)),
  });
  if (!source) {
    [source] = await db
      .insert(schema.leadSources)
      .values({ companyId, name: data.sourceName, type: data.meta ? "paid_ad" : "organic" })
      .returning();
  }

  let ownerId = data.ownerId ?? null;
  if (!ownerId) {
    const seller = await db.query.companyMembers.findFirst({
      where: and(eq(schema.companyMembers.companyId, companyId), eq(schema.companyMembers.active, true), eq(schema.companyMembers.isSeller, true)),
      orderBy: [asc(schema.companyMembers.createdAt)],
    });
    ownerId = seller?.id ?? null;
  }

  const stage = await db.query.pipelineStages.findFirst({
    where: and(eq(schema.pipelineStages.companyId, companyId), eq(schema.pipelineStages.kind, "open")),
    orderBy: [asc(schema.pipelineStages.position)],
  });

  const contact = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(schema.contacts)
      .values({
        companyId,
        name: data.name,
        phone: data.phone,
        whatsapp: data.phone,
        email: data.email ?? null,
        ownerId,
        sourceId: source.id,
        metaLeadId: data.meta?.leadId,
        metaCampaignId: data.meta?.campaignId,
        metaAdsetId: data.meta?.adsetId,
        metaAdId: data.meta?.adId,
        lastInteractionAt: new Date(),
      })
      .returning();
    if (stage) {
      const [{ pos }] = await tx
        .select({ pos: max(schema.deals.position) })
        .from(schema.deals)
        .where(eq(schema.deals.stageId, stage.id));
      const [deal] = await tx
        .insert(schema.deals)
        .values({ companyId, contactId: c.id, stageId: stage.id, ownerId, title: `Oportunidade · ${data.name}`, position: (pos ?? 0) + 1 })
        .returning();
      await tx.insert(schema.dealStageHistory).values({ companyId, dealId: deal.id, toStage: stage.id });
      await logActivity(tx, { companyId }, { contactId: c.id, dealId: deal.id, type: "lead_created", payload: { name: data.name, source: data.sourceName } });
    }
    await notifyMember(tx, companyId, ownerId, {
      type: "new_lead",
      title: `Novo lead via ${data.sourceName}`,
      body: data.name,
      link: `/clientes/${c.id}`,
    });
    return c;
  });
  return { contact, created: true };
}
