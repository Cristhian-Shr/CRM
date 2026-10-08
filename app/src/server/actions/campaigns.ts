"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { syncMetaConnection } from "@/lib/integrations/meta";
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
