"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { getContactOr404, logActivity } from "@/lib/db/tenant";
import { sendText } from "@/lib/integrations/whatsapp";
import { str } from "@/lib/utils";
import { safe } from "../safe";

const { conversations, messages, whatsappAccounts } = schema;

/** Envia mensagem pela ficha. Sem WhatsApp conectado, grava como nota interna. */
export async function sendMessage(contactId: string, fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    const contact = await getContactOr404(ctx, contactId);
    const body = z.string().min(1, "Escreva a mensagem.").parse(str(fd, "body"));
    const internal = fd.get("internal") === "1";

    const account = await db.query.whatsappAccounts.findFirst({
      where: and(eq(whatsappAccounts.companyId, ctx.companyId), eq(whatsappAccounts.status, "connected")),
    });
    let conv = await db.query.conversations.findFirst({
      where: and(eq(conversations.companyId, ctx.companyId), eq(conversations.contactId, contactId)),
      orderBy: [desc(conversations.lastMessageAt)],
    });
    if (!conv) {
      [conv] = await db
        .insert(conversations)
        .values({ companyId: ctx.companyId, contactId, whatsappAccountId: account?.id, assignedTo: contact.ownerId })
        .returning();
    }

    let externalId: string | null = null;
    let status = "sent";
    if (!internal) {
      const to = contact.whatsapp ?? contact.phone;
      if (!account || !account.phoneNumberId || !account.accessTokenEnc)
        return { error: "WhatsApp não conectado. Conecte em Configurações → Integrações ou envie como nota interna." };
      if (!to) return { error: "Este cliente não tem WhatsApp cadastrado." };
      const lastIn = conv.lastInboundAt?.getTime() ?? 0;
      if (Date.now() - lastIn > 24 * 3_600_000)
        return { error: "Fora da janela de 24h do WhatsApp: só é possível enviar modelos aprovados pela Meta." };
      externalId = await sendText(account.phoneNumberId, decrypt(account.accessTokenEnc), to, body);
    }

    const now = new Date();
    await db.insert(messages).values({
      companyId: ctx.companyId,
      conversationId: conv.id,
      direction: "outbound",
      senderType: internal ? "system" : "user",
      senderUserId: ctx.userId,
      type: internal ? "note" : "text",
      body,
      externalId,
      status: internal ? null : status,
      sentAt: now,
    });
    await db.update(conversations).set({ lastMessageAt: now, unreadCount: 0 }).where(eq(conversations.id, conv.id));
    if (!internal) await logActivity(db, ctx, { contactId, type: "message_out", payload: { text: body.slice(0, 140) } });
    await db.update(schema.contacts).set({ lastInteractionAt: now }).where(eq(schema.contacts.id, contactId));
    revalidatePath(`/clientes/${contactId}`);
    revalidatePath("/conversas");
  });
}

export async function markConversationRead(conversationId: string) {
  const ctx = await getContext();
  await db
    .update(conversations)
    .set({ unreadCount: 0 })
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, ctx.companyId)));
  revalidatePath("/conversas");
}
