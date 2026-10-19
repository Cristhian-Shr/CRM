"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { COMPANY_SERVICES } from "@/lib/services";
import { str } from "@/lib/utils";
import { safe } from "../safe";

const SERVICE_KEYS: readonly string[] = COMPANY_SERVICES.map((s) => s.key);

/** O admin da empresa solicita a contratação de um serviço à agência. */
export async function requestService(fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    assertCan(ctx, "settings.manage");
    const service = str(fd, "service");
    if (!service || !SERVICE_KEYS.includes(service)) throw new Error("Serviço inválido.");

    const active = await db.query.companyServices.findFirst({
      where: and(eq(schema.companyServices.companyId, ctx.companyId), eq(schema.companyServices.service, service)),
    });
    if (active) throw new Error("Este serviço já está ativo na sua conta.");

    const pending = await db.query.serviceRequests.findFirst({
      where: and(
        eq(schema.serviceRequests.companyId, ctx.companyId),
        eq(schema.serviceRequests.service, service),
        eq(schema.serviceRequests.status, "pending"),
      ),
    });
    if (pending) throw new Error("Já existe uma solicitação pendente para este serviço.");

    await db.insert(schema.serviceRequests).values({
      companyId: ctx.companyId,
      service,
      note: str(fd, "note"),
      requestedBy: ctx.userId,
    });
    revalidatePath("/servicos");
    revalidatePath("/master");
    revalidatePath("/master/solicitacoes");
  });
}
