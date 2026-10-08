"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getContactOr404, logActivity } from "@/lib/db/tenant";
import { can } from "@/lib/permissions";
import { money, parseMoney, str, todayISO } from "@/lib/utils";
import { safe } from "../safe";

const { orders, orderItems, procedures, programs, programItems, contractedSessions, deals, receivables } = schema;

const itemSchema = z.object({
  type: z.enum(["procedure", "program"]),
  id: z.string().uuid(),
  quantity: z.number().int().min(1),
});

/** "AAAA-MM-DD" + N meses, grampeando o dia ao último do mês de destino. */
function addMonthsISO(iso: string, months: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, lastDay));
  return t.toISOString().slice(0, 10);
}

/** Divide o total em N parcelas inteiras (a última absorve o arredondamento). */
function splitInstallments(total: number, n: number) {
  const base = Math.floor(total / n);
  const parts = Array(n).fill(base);
  parts[n - 1] += total - base * n;
  return parts;
}

type OrderRow = typeof schema.orders.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Gera as contas a receber (parcelas) de uma comanda confirmada. */
async function generateReceivables(tx: Tx, companyId: string, userId: string, order: OrderRow, firstDueISO: string) {
  if (order.totalCents <= 0) return;
  const n = Math.max(1, order.installments ?? 1);
  const parts = splitInstallments(order.totalCents, n);
  await tx.insert(receivables).values(
    parts.map((amountCents, i) => ({
      companyId,
      orderId: order.id,
      contactId: order.contactId,
      description: n > 1 ? `Comanda · parcela ${i + 1}/${n}` : "Comanda",
      amountCents,
      dueDate: addMonthsISO(firstDueISO, i),
      paymentMethod: order.paymentMethod,
      installmentNo: i + 1,
      installmentsTotal: n,
      createdBy: userId,
    })),
  );
}

/**
 * Comanda: copia nomes e preços do catálogo, gera o saldo de sessões
 * (um programa "10x drenagem + 5x radiofrequência" vira dois saldos)
 * e atualiza o valor da oportunidade.
 */
export async function createOrder(contactId: string, fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    const contact = await getContactOr404(ctx, contactId);
    const items = z.array(itemSchema).min(1, "Adicione um programa ou procedimento.").parse(JSON.parse(String(fd.get("items") ?? "[]")));
    const dealId = str(fd, "dealId");
    const confirm = fd.get("confirm") === "1";
    const firstDue = /^\d{4}-\d{2}-\d{2}$/.test(str(fd, "firstDueDate") ?? "") ? str(fd, "firstDueDate")! : todayISO();

    const procIds = items.filter((i) => i.type === "procedure").map((i) => i.id);
    const progIds = items.filter((i) => i.type === "program").map((i) => i.id);
    const procs = procIds.length
      ? await db.select().from(procedures).where(and(eq(procedures.companyId, ctx.companyId), inArray(procedures.id, procIds)))
      : [];
    const progs = progIds.length
      ? await db.select().from(programs).where(and(eq(programs.companyId, ctx.companyId), inArray(programs.id, progIds)))
      : [];
    const progItems = progIds.length ? await db.select().from(programItems).where(inArray(programItems.programId, progIds)) : [];

    const lines = items.map((i) => {
      const src = i.type === "procedure" ? procs.find((p) => p.id === i.id) : progs.find((p) => p.id === i.id);
      if (!src) throw new Error("Item da comanda inválido.");
      return { ...i, name: src.name, unit: src.priceCents, total: src.priceCents * i.quantity, validityDays: "validityDays" in src ? src.validityDays : null };
    });
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const discount = Math.min(subtotal, parseMoney(str(fd, "discount")));
    const maxPct = ctx.settings.maxDiscountPercent ?? 100;
    if (subtotal && (discount / subtotal) * 100 > maxPct && !can(ctx, "discount.overLimit"))
      return { error: `Desconto acima do limite de ${maxPct}%. Peça a um admin.` };

    const total = subtotal - discount;
    await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          companyId: ctx.companyId,
          contactId,
          dealId,
          sellerId: contact.ownerId ?? ctx.memberId,
          status: confirm ? "confirmed" : "draft",
          subtotalCents: subtotal,
          discountCents: discount,
          totalCents: total,
          paymentMethod: str(fd, "paymentMethod"),
          installments: Number(str(fd, "installments")) || null,
          notes: str(fd, "notes"),
          confirmedAt: confirm ? new Date() : null,
        })
        .returning();
      for (const l of lines) {
        const [oi] = await tx
          .insert(orderItems)
          .values({
            orderId: order.id,
            itemType: l.type,
            procedureId: l.type === "procedure" ? l.id : null,
            programId: l.type === "program" ? l.id : null,
            description: l.name,
            quantity: l.quantity,
            unitPriceCents: l.unit,
            totalCents: l.total,
          })
          .returning();
        if (!confirm) continue;
        await createSessions(tx, ctx.companyId, contactId, oi.id, l, progItems);
      }
      if (dealId) {
        await tx.update(deals).set({ valueCents: total, updatedAt: new Date() }).where(and(eq(deals.id, dealId), eq(deals.companyId, ctx.companyId)));
      }
      if (confirm) await generateReceivables(tx, ctx.companyId, ctx.userId, order, firstDue);
      await logActivity(tx, ctx, {
        contactId,
        dealId,
        type: "order_created",
        payload: { total: money(total), items: lines.map((l) => `${l.quantity}x ${l.name}`).join(", "), status: order.status },
      });
    });
    revalidatePath(`/clientes/${contactId}`);
    revalidatePath("/dashboard");
    revalidatePath("/funil");
    revalidatePath("/financeiro");
  });
}

type Line = { type: "procedure" | "program"; id: string; quantity: number; validityDays: number | null };
async function createSessions(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: string,
  contactId: string,
  orderItemId: string,
  l: Line,
  progItems: (typeof programItems.$inferSelect)[],
) {
  const expires = l.validityDays ? todayISO(undefined, new Date(Date.now() + l.validityDays * 86_400_000)) : null;
  const rows =
    l.type === "procedure"
      ? [{ procedureId: l.id, programId: null, sessions: l.quantity }]
      : progItems
          .filter((pi) => pi.programId === l.id)
          .map((pi) => ({ procedureId: pi.procedureId, programId: l.id, sessions: pi.sessions * l.quantity }));
  if (!rows.length) return;
  await tx.insert(contractedSessions).values(
    rows.map((r) => ({
      companyId,
      contactId,
      orderItemId,
      procedureId: r.procedureId,
      programId: r.programId,
      sessionsTotal: r.sessions,
      expiresAt: expires,
    })),
  );
}

export async function confirmOrder(orderId: string, fd?: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    const order = await db.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.companyId, ctx.companyId)) });
    if (!order || order.status !== "draft") throw new Error("Comanda não encontrada ou já confirmada.");
    const firstDue = fd && /^\d{4}-\d{2}-\d{2}$/.test(str(fd, "firstDueDate") ?? "") ? str(fd, "firstDueDate")! : todayISO();
    await getContactOr404(ctx, order.contactId);
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const progIds = items.map((i) => i.programId).filter(Boolean) as string[];
    const progs = progIds.length ? await db.select().from(programs).where(inArray(programs.id, progIds)) : [];
    const progItems = progIds.length ? await db.select().from(programItems).where(inArray(programItems.programId, progIds)) : [];
    await db.transaction(async (tx) => {
      await tx.update(orders).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(orders.id, orderId));
      for (const it of items) {
        await createSessions(
          tx,
          ctx.companyId,
          order.contactId,
          it.id,
          {
            type: it.itemType as "procedure" | "program",
            id: (it.procedureId ?? it.programId)!,
            quantity: it.quantity,
            validityDays: progs.find((p) => p.id === it.programId)?.validityDays ?? null,
          },
          progItems,
        );
      }
      await generateReceivables(tx, ctx.companyId, ctx.userId, order, firstDue);
      await logActivity(tx, ctx, { contactId: order.contactId, type: "order_created", payload: { total: money(order.totalCents), status: "confirmed" } });
    });
    revalidatePath(`/clientes/${order.contactId}`);
    revalidatePath("/dashboard");
    revalidatePath("/financeiro");
  });
}

export async function cancelOrder(orderId: string) {
  return safe(async () => {
    const ctx = await getContext();
    const order = await db.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.companyId, ctx.companyId)) });
    if (!order) throw new Error("Comanda não encontrada.");
    await getContactOr404(ctx, order.contactId);
    const items = await db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, orderId));
    const sessions = items.length
      ? await db.select().from(contractedSessions).where(inArray(contractedSessions.orderItemId, items.map((i) => i.id)))
      : [];
    if (sessions.some((s) => s.sessionsUsed > 0)) throw new Error("Esta comanda já tem sessões realizadas e não pode ser cancelada.");
    await db.transaction(async (tx) => {
      if (sessions.length) {
        await tx
          .update(schema.appointments)
          .set({ contractedSessionId: null })
          .where(inArray(schema.appointments.contractedSessionId, sessions.map((s) => s.id)));
        await tx.delete(contractedSessions).where(inArray(contractedSessions.id, sessions.map((s) => s.id)));
      }
      await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, orderId));
      // Cancela parcelas ainda não pagas desta comanda.
      await tx
        .update(receivables)
        .set({ status: "canceled" })
        .where(and(eq(receivables.orderId, orderId), eq(receivables.status, "pending")));
    });
    revalidatePath(`/clientes/${order.contactId}`);
    revalidatePath("/dashboard");
    revalidatePath("/financeiro");
  });
}
