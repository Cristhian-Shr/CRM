import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { decrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/tenant";
import { sendTemplate } from "@/lib/integrations/whatsapp";
import { fmtDate, fmtTime, toLocalInput, zonedToUtc } from "@/lib/utils";
import { cronAuthorized } from "../auth";

export const dynamic = "force-dynamic";

const { appointments, companyMembers, contacts, conversations, messages, users, whatsappAccounts } = schema;

/** Janela do dia seguinte (00:00–00:00) no fuso America/Sao_Paulo, convertida para UTC. */
function tomorrowWindow() {
  const today = toLocalInput(new Date()).slice(0, 10);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const tomorrow = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 1);
  const dayAfter = d.toISOString().slice(0, 10);
  return { start: zonedToUtc(`${tomorrow}T00:00`), end: zonedToUtc(`${dayAfter}T00:00`) };
}

/**
 * Roda 1x/dia (via n8n): manda o lembrete de confirmação no WhatsApp para quem
 * tem agendamento amanhã ainda não confirmado. Idempotente por reminder_sent_at.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return new NextResponse("unauthorized", { status: 401 });
  const { start, end } = tomorrowWindow();

  const rows = await db
    .select({
      id: appointments.id,
      companyId: appointments.companyId,
      contactId: appointments.contactId,
      startsAt: appointments.startsAt,
      contactName: contacts.name,
      phone: contacts.phone,
      whatsapp: contacts.whatsapp,
      ownerId: contacts.ownerId,
      professional: users.name,
    })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .leftJoin(companyMembers, eq(companyMembers.id, appointments.professionalId))
    .leftJoin(users, eq(users.id, companyMembers.userId))
    .where(
      and(
        gte(appointments.startsAt, start),
        lt(appointments.startsAt, end),
        eq(appointments.status, "scheduled"),
        isNull(appointments.reminderSentAt),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(1000);

  // Carrega a conta de WhatsApp de cada empresa uma única vez.
  const accounts = new Map<string, typeof whatsappAccounts.$inferSelect | null>();
  async function accountFor(companyId: string) {
    if (!accounts.has(companyId)) {
      const acc = await db.query.whatsappAccounts.findFirst({ where: eq(whatsappAccounts.companyId, companyId) });
      accounts.set(companyId, acc ?? null);
    }
    return accounts.get(companyId) ?? null;
  }

  let enviados = 0;
  let pulados = 0;
  let erros = 0;

  for (const r of rows) {
    const account = await accountFor(r.companyId);
    const template = account?.settings?.confirmTemplate;
    if (!account?.phoneNumberId || !account.accessTokenEnc || !template?.name) {
      pulados++;
      continue;
    }
    const to = r.whatsapp ?? r.phone;
    if (!to) {
      pulados++;
      continue;
    }

    const dateStr = fmtDate(r.startsAt, { day: "2-digit", month: "2-digit" });
    const timeStr = fmtTime(r.startsAt);
    try {
      const externalId = await sendTemplate(account.phoneNumberId, decrypt(account.accessTokenEnc), to, template, [
        r.contactName,
        dateStr,
        timeStr,
        r.professional ?? "a definir",
      ]);

      let conv = await db.query.conversations.findFirst({
        where: and(eq(conversations.companyId, r.companyId), eq(conversations.contactId, r.contactId)),
      });
      if (!conv) {
        [conv] = await db
          .insert(conversations)
          .values({ companyId: r.companyId, contactId: r.contactId, whatsappAccountId: account.id, assignedTo: r.ownerId })
          .returning();
      }
      const now = new Date();
      await db.insert(messages).values({
        companyId: r.companyId,
        conversationId: conv.id,
        direction: "outbound",
        senderType: "system",
        type: "template",
        body: `Lembrete de confirmação enviado (agendamento ${dateStr} às ${timeStr}).`,
        externalId,
        status: "sent",
        sentAt: now,
      });
      await db.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conv.id));
      await logActivity(db, { companyId: r.companyId }, { contactId: r.contactId, type: "message_out", payload: { text: "Lembrete de confirmação de agenda" } });
      await db.update(appointments).set({ reminderSentAt: now }).where(eq(appointments.id, r.id));
      enviados++;
    } catch {
      erros++;
    }
  }

  return NextResponse.json({ enviados, pulados, erros });
}
