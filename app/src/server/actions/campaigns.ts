"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { backfillMetaMonth as backfillMetaMonthLib, syncMetaConnection } from "@/lib/integrations/meta";
import { assertCan } from "@/lib/permissions";
import { safe } from "../safe";

export async function syncMetaNow() {
  return safe(async () => {
    const ctx = await getContext();
    assertCan(ctx, "campaigns.view");
    const conns = await db.select().from(schema.metaConnections).where(eq(schema.metaConnections.companyId, ctx.companyId));
    if (!conns.length) throw new Error("Conecte a conta de anúncios em Configurações → Integrações.");
    for (const c of conns) await syncMetaConnection(c);
    revalidatePath("/campanhas");
  });
}

/**
 * Importa o histórico de UM mês (monthsAgo = 0 é o mês atual, 1 o anterior, ...).
 * Tem retorno próprio (não usa safe()) para o cliente ler rows/done e exibir progresso.
 */
export async function backfillMetaMonth(
  monthsAgo: number,
): Promise<{ month: string; rows: number; done: boolean; error?: string }> {
  try {
    const ctx = await getContext();
    assertCan(ctx, "campaigns.view");
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
    const year = target.getUTCFullYear();
    const month = target.getUTCMonth() + 1;
    const conns = await db.select().from(schema.metaConnections).where(eq(schema.metaConnections.companyId, ctx.companyId));
    let rows = 0;
    for (const c of conns) rows += (await backfillMetaMonthLib(c, year, month)).rows;
    const done = monthsAgo >= 37;
    if (done) revalidatePath("/campanhas");
    return { month: `${year}-${String(month).padStart(2, "0")}`, rows, done };
  } catch (e) {
    return { month: "", rows: 0, done: true, error: e instanceof Error ? e.message : "Erro ao importar o histórico." };
  }
}

export async function saveBalanceAlert(formData: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    if (!ctx.isMaster) throw new Error("Apenas o admin mestre configura o alerta de saldo.");
    const connectionId = String(formData.get("connectionId"));
    const enabled = formData.get("enabled") === "on";
    const limitReais = Number(String(formData.get("limit") ?? "0").replace(",", "."));
    const phone = String(formData.get("phone") ?? "").replace(/\D/g, "");
    await db
      .update(schema.metaConnections)
      .set({ alertEnabled: enabled, lowBalanceAlertCents: Math.round(limitReais * 100), alertPhone: phone || null })
      .where(eq(schema.metaConnections.id, connectionId));
    revalidatePath("/campanhas");
  });
}
