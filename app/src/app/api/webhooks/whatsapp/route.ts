import { and, eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/lib/db";
import { logActivity, notifyMember } from "@/lib/db/tenant";
import { messageText, verifySignature, type WaWebhook } from "@/lib/integrations/whatsapp";
import { normalizePhone } from "@/lib/utils";
import { upsertInboundLead } from "@/server/intake";

export const dynamic = "force-dynamic";

/** Verificação do webhook pela Meta (configuração inicial). */
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(p.get("hub.challenge"), { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/** Recebimento de mensagens e atualizações de status. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }
  const body = JSON.parse(raw) as WaWebhook;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const v = change.value;
      const account = v.metadata?.phone_number_id
        ? await db.query.whatsappAccounts.findFirst({ where: eq(schema.whatsappAccounts.phoneNumberId, v.metadata.phone_number_id) })
        : null;
      if (!account) continue;
      const companyId = account.companyId;

      for (const st of v.statuses ?? []) {
        await db
          .update(schema.messages)
          .set({ status: st.status })
          .where(and(eq(schema.messages.companyId, companyId), eq(schema.messages.externalId, st.id)));
      }

      for (const m of v.messages ?? []) {
        const phone = normalizePhone(`+${m.from}`);
        const profileName = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        const fromAd = m.referral?.source_type === "ad";
        const { contact, created } = await upsertInboundLead(companyId, {
          name: profileName || phone || "Contato WhatsApp",
          phone,
          sourceName: fromAd ? "Anúncio (WhatsApp)" : "WhatsApp",
          ownerId: account.defaultOwnerId,
          meta: fromAd ? { adId: m.referral?.source_id } : undefined,
        });

        let conv = await db.query.conversations.findFirst({
          where: and(eq(schema.conversations.companyId, companyId), eq(schema.conversations.contactId, contact.id)),
        });
        if (!conv) {
          [conv] = await db
            .insert(schema.conversations)
            .values({ companyId, contactId: contact.id, whatsappAccountId: account.id, assignedTo: contact.ownerId })
            .returning();
        }
        const sentAt = new Date(Number(m.timestamp) * 1000);
        const text = messageText(m);
        const inserted = await db
          .insert(schema.messages)
          .values({
            companyId,
            conversationId: conv.id,
            direction: "inbound",
            senderType: "contact",
            type: m.type === "text" ? "text" : m.type,
            body: text,
            externalId: m.id,
            sentAt,
          })
          .onConflictDoNothing()
          .returning({ id: schema.messages.id });
        if (!inserted.length) continue; // reentrega da Meta

        await db
          .update(schema.conversations)
          .set({ lastMessageAt: sentAt, lastInboundAt: sentAt, unreadCount: sql`${schema.conversations.unreadCount} + 1` })
          .where(eq(schema.conversations.id, conv.id));
        await db.update(schema.contacts).set({ lastInteractionAt: sentAt }).where(eq(schema.contacts.id, contact.id));
        await logActivity(db, { companyId }, { contactId: contact.id, type: "message_in", payload: { text: text.slice(0, 140) } });
        if (!created) {
          await notifyMember(db, companyId, contact.ownerId, {
            type: "new_message",
            title: `Mensagem de ${contact.name}`,
            body: text.slice(0, 80),
            link: `/conversas?c=${conv.id}`,
          });
        }
      }
    }
  }
  return NextResponse.json({ ok: true });
}
