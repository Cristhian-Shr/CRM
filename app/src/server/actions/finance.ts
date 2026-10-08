"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/db/tenant";
import { assertCan } from "@/lib/permissions";
import { parseMoney, str } from "@/lib/utils";
import { safe } from "../safe";

/** Financeiro é restrito a admin/master. */
async function adminCtx() {
  const ctx = await getContext();
  assertCan(ctx, "reports.viewAll");
  return ctx;
}

/** Lança uma conta a receber avulsa (não ligada a comanda). */
export async function createReceivable(fd: FormData) {
  return safe(async () => {
    const ctx = await adminCtx();
    const data = z
      .object({
        contactId: z.string().uuid("Selecione o cliente."),
        description: z.string().min(2, "Informe a descrição."),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe o vencimento."),
      })
      .parse({
        contactId: str(fd, "contactId") ?? "",
        description: str(fd, "description") ?? "",
        dueDate: str(fd, "dueDate") ?? "",
      });
    const amountCents = parseMoney(str(fd, "amount"));
    if (amountCents <= 0) return { error: "Informe um valor maior que zero." };
    const contact = await db.query.contacts.findFirst({
      where: and(eq(schema.contacts.id, data.contactId), eq(schema.contacts.companyId, ctx.companyId)),
    });
    if (!contact) return { error: "Cliente não encontrado." };

    await db.insert(schema.receivables).values({
      companyId: ctx.companyId,
      contactId: data.contactId,
      description: data.description,
      amountCents,
      dueDate: data.dueDate,
      paymentMethod: str(fd, "paymentMethod"),
      createdBy: ctx.userId,
    });
    await audit(db, { companyId: ctx.companyId, userId: ctx.userId, action: "receivable.create", entity: "receivable" });
    revalidatePath("/financeiro");
    revalidatePath("/dashboard");
    return { ok: true };
  });
}

export async function setReceivableStatus(id: string, status: "paid" | "pending") {
  const ctx = await adminCtx();
  await db
    .update(schema.receivables)
    .set({ status, paidAt: status === "paid" ? new Date() : null })
    .where(and(eq(schema.receivables.id, id), eq(schema.receivables.companyId, ctx.companyId)));
  await audit(db, { companyId: ctx.companyId, userId: ctx.userId, action: `receivable.${status}`, entity: "receivable", entityId: id });
  revalidatePath("/financeiro");
  revalidatePath("/dashboard");
}

export async function deleteReceivable(id: string) {
  const ctx = await adminCtx();
  await db.delete(schema.receivables).where(and(eq(schema.receivables.id, id), eq(schema.receivables.companyId, ctx.companyId)));
  await audit(db, { companyId: ctx.companyId, userId: ctx.userId, action: "receivable.delete", entity: "receivable", entityId: id });
  revalidatePath("/financeiro");
  revalidatePath("/dashboard");
}
