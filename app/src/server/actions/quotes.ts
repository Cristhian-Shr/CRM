"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getContactOr404 } from "@/lib/db/tenant";
import { parseMoney, str } from "@/lib/utils";
import { cancelOrder, confirmOrder } from "./orders";
import { safe } from "../safe";

const { quotes, quoteItems, procedures, programs, orders, orderItems } = schema;

const itemSchema = z.object({
  type: z.enum(["procedure", "program"]),
  id: z.string().uuid(),
  quantity: z.number().int().min(1),
  discount: z.number().int().min(0).default(0),
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Monta as linhas do orçamento a partir do catálogo (preços vêm do servidor). */
async function buildLines(companyId: string, raw: z.infer<typeof itemSchema>[]) {
  const procIds = raw.filter((i) => i.type === "procedure").map((i) => i.id);
  const progIds = raw.filter((i) => i.type === "program").map((i) => i.id);
  const procs = procIds.length
    ? await db.select().from(procedures).where(and(eq(procedures.companyId, companyId), inArray(procedures.id, procIds)))
    : [];
  const progs = progIds.length
    ? await db.select().from(programs).where(and(eq(programs.companyId, companyId), inArray(programs.id, progIds)))
    : [];
  return raw.map((i) => {
    const src = i.type === "procedure" ? procs.find((p) => p.id === i.id) : progs.find((p) => p.id === i.id);
    if (!src) throw new Error("Item do orçamento inválido.");
    const unit = src.priceCents;
    const discount = Math.min(i.discount, unit * i.quantity);
    return {
      itemType: i.type,
      procedureId: i.type === "procedure" ? i.id : null,
      programId: i.type === "program" ? i.id : null,
      description: src.name,
      quantity: i.quantity,
      unitPriceCents: unit,
      discountCents: discount,
      totalCents: unit * i.quantity - discount,
    };
  });
}

export async function saveQuote(quoteId: string | null, fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    const contactId = z.string().uuid("Selecione o cliente.").parse(str(fd, "contactId"));
    await getContactOr404(ctx, contactId);
    const raw = z.array(itemSchema).min(1, "Adicione ao menos um item.").parse(JSON.parse(String(fd.get("items") ?? "[]")));
    const lines = await buildLines(ctx.companyId, raw);

    const subtotal = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
    const discount = lines.reduce((s, l) => s + l.discountCents, 0);
    const total = subtotal - discount;
    const validUntil = /^\d{4}-\d{2}-\d{2}$/.test(str(fd, "validUntil") ?? "") ? str(fd, "validUntil")! : null;

    const base = {
      contactId,
      sellerId: str(fd, "sellerId") ?? ctx.memberId,
      validUntil,
      subtotalCents: subtotal,
      discountCents: discount,
      totalCents: total,
      entryCents: parseMoney(str(fd, "entry")),
      paymentMethod: str(fd, "paymentMethod"),
      installments: Number(str(fd, "installments")) || null,
      notes: str(fd, "notes"),
      updatedAt: new Date(),
    };

    await db.transaction(async (tx) => {
      let id = quoteId;
      let linkedOrderId: string | null = null;
      if (id) {
        const existing = await tx.query.quotes.findFirst({ where: and(eq(quotes.id, id), eq(quotes.companyId, ctx.companyId)) });
        if (!existing) throw new Error("Orçamento não encontrado.");
        linkedOrderId = existing.orderId;
        await tx.update(quotes).set(base).where(eq(quotes.id, id));
        await tx.delete(quoteItems).where(eq(quoteItems.quoteId, id));
      } else {
        const [{ max }] = await tx
          .select({ max: sql<number>`coalesce(max(${quotes.number}),0)::int` })
          .from(quotes)
          .where(eq(quotes.companyId, ctx.companyId));
        const [created] = await tx
          .insert(quotes)
          .values({ ...base, companyId: ctx.companyId, number: max + 1, createdBy: ctx.userId })
          .returning();
        id = created.id;
      }
      await tx.insert(quoteItems).values(lines.map((l) => ({ ...l, quoteId: id! })));

      // Se já gerou comanda e ela ainda está em rascunho, mantém em sincronia com a edição.
      if (linkedOrderId) {
        const ord = await tx.query.orders.findFirst({ where: eq(orders.id, linkedOrderId) });
        if (ord && ord.status === "draft") {
          await tx
            .update(orders)
            .set({
              subtotalCents: subtotal,
              discountCents: discount,
              totalCents: total,
              paymentMethod: base.paymentMethod,
              installments: base.installments,
              notes: base.notes,
            })
            .where(eq(orders.id, linkedOrderId));
          await tx.delete(orderItems).where(eq(orderItems.orderId, linkedOrderId));
          await tx.insert(orderItems).values(
            lines.map((l) => ({
              orderId: linkedOrderId!,
              itemType: l.itemType,
              procedureId: l.procedureId,
              programId: l.programId,
              description: l.description,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
              totalCents: l.totalCents,
            })),
          );
        }
      }
    });
    revalidatePath("/orcamentos");
    revalidatePath(`/clientes/${contactId}`);
    revalidatePath("/dashboard");
    revalidatePath("/financeiro");
    return { ok: true };
  });
}

export async function deleteQuote(id: string) {
  const ctx = await getContext();
  await db.delete(quotes).where(and(eq(quotes.id, id), eq(quotes.companyId, ctx.companyId)));
  revalidatePath("/orcamentos");
}

/** Estorna um orçamento convertido: desvincula da comanda e volta para "Aberto". */
export async function reopenQuote(id: string) {
  return safe(async () => {
    const ctx = await getContext();
    const quote = await db.query.quotes.findFirst({ where: and(eq(quotes.id, id), eq(quotes.companyId, ctx.companyId)) });
    if (!quote) return { error: "Orçamento não encontrado." };
    if (quote.status !== "converted" || !quote.orderId) return { error: "Este orçamento não está convertido." };
    const ord = await db.query.orders.findFirst({ where: eq(orders.id, quote.orderId) });

    // Comanda confirmada: cancela (estorna parcelas pendentes e sessões não usadas) antes de reabrir.
    if (ord && ord.status === "confirmed") {
      const r = await cancelOrder(ord.id);
      if (r && "error" in r && r.error) return { error: r.error };
    }

    await db.transaction(async (tx) => {
      // Desvincula primeiro (a FK quotes.order_id impede deletar a comanda antes disso).
      await tx.update(quotes).set({ status: "open", orderId: null, updatedAt: new Date() }).where(eq(quotes.id, id));
      // Rascunho criado automaticamente pode ser removido de vez.
      if (ord && ord.status === "draft") {
        await tx.delete(orderItems).where(eq(orderItems.orderId, ord.id));
        await tx.delete(orders).where(eq(orders.id, ord.id));
      }
    });
    revalidatePath("/orcamentos");
    revalidatePath(`/clientes/${quote.contactId}`);
    revalidatePath("/dashboard");
    revalidatePath("/financeiro");
    return { ok: true };
  });
}

/** Gera uma comanda (rascunho) a partir do orçamento e marca-o como convertido. */
export async function convertQuoteToOrder(id: string) {
  return safe(async () => {
    const ctx = await getContext();
    const quote = await db.query.quotes.findFirst({ where: and(eq(quotes.id, id), eq(quotes.companyId, ctx.companyId)) });
    if (!quote) return { error: "Orçamento não encontrado." };
    if (quote.status === "converted" || quote.orderId) return { error: "Este orçamento já virou comanda." };
    await getContactOr404(ctx, quote.contactId);
    const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, id));
    if (!items.length) return { error: "Orçamento sem itens." };

    let orderId = "";
    await db.transaction(async (tx: Tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          companyId: ctx.companyId,
          contactId: quote.contactId,
          sellerId: quote.sellerId,
          status: "draft",
          subtotalCents: quote.subtotalCents,
          discountCents: quote.discountCents,
          totalCents: quote.totalCents,
          paymentMethod: quote.paymentMethod,
          installments: quote.installments,
          notes: quote.notes,
        })
        .returning();
      orderId = order.id;
      await tx.insert(orderItems).values(
        items.map((it) => ({
          orderId: order.id,
          itemType: it.itemType,
          procedureId: it.procedureId,
          programId: it.programId,
          description: it.description,
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          totalCents: it.totalCents,
        })),
      );
      await tx.update(quotes).set({ status: "converted", orderId: order.id, updatedAt: new Date() }).where(eq(quotes.id, id));
    });

    // Fecha a venda: confirma a comanda (gera saldo de sessões e as contas a receber, 1ª parcela hoje).
    const r = await confirmOrder(orderId);
    if (r && "error" in r && r.error) {
      // Compensação: desfaz a conversão (reabre o orçamento e remove a comanda rascunho).
      await db.transaction(async (tx) => {
        await tx.update(quotes).set({ status: "open", orderId: null, updatedAt: new Date() }).where(eq(quotes.id, id));
        await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
        await tx.delete(orders).where(eq(orders.id, orderId));
      });
      return { error: r.error };
    }

    revalidatePath("/orcamentos");
    revalidatePath(`/clientes/${quote.contactId}`);
    revalidatePath("/dashboard");
    revalidatePath("/financeiro");
    return { ok: true };
  });
}
