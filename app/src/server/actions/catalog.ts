"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { parseMoney, str } from "@/lib/utils";
import { safe } from "../safe";

const { procedures, programs, programItems } = schema;

export async function saveProcedure(id: string | null, fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    assertCan(ctx, "catalog.manage");
    const values = {
      name: z.string().min(2, "Informe o nome do procedimento.").parse(str(fd, "name")),
      category: str(fd, "category"),
      description: str(fd, "description"),
      priceCents: parseMoney(str(fd, "price")),
      durationMinutes: Number(str(fd, "duration") ?? 60) || 60,
    };
    if (id) {
      await db.update(procedures).set(values).where(and(eq(procedures.id, id), eq(procedures.companyId, ctx.companyId)));
    } else {
      await db.insert(procedures).values({ ...values, companyId: ctx.companyId });
    }
    revalidatePath("/catalogo");
  });
}

export async function toggleProcedure(id: string, active: boolean) {
  const ctx = await getContext();
  assertCan(ctx, "catalog.manage");
  await db.update(procedures).set({ active }).where(and(eq(procedures.id, id), eq(procedures.companyId, ctx.companyId)));
  revalidatePath("/catalogo");
}

/** Programa = pacote de procedimentos com quantidade de sessões. Itens chegam como JSON. */
export async function saveProgram(id: string | null, fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    assertCan(ctx, "catalog.manage");
    const items = z
      .array(z.object({ procedureId: z.string().uuid(), sessions: z.number().int().min(1) }))
      .min(1, "Adicione ao menos um procedimento ao programa.")
      .parse(JSON.parse(String(fd.get("items") ?? "[]")));

    const owned = await db.select({ id: procedures.id }).from(procedures).where(eq(procedures.companyId, ctx.companyId));
    if (items.some((i) => !owned.find((o) => o.id === i.procedureId))) throw new Error("Procedimento inválido.");

    const values = {
      name: z.string().min(2, "Informe o nome do programa.").parse(str(fd, "name")),
      description: str(fd, "description"),
      priceCents: parseMoney(str(fd, "price")),
      validityDays: Number(str(fd, "validityDays")) || null,
    };
    await db.transaction(async (tx) => {
      let programId = id;
      if (programId) {
        await tx.update(programs).set(values).where(and(eq(programs.id, programId), eq(programs.companyId, ctx.companyId)));
        await tx.delete(programItems).where(eq(programItems.programId, programId));
      } else {
        [{ id: programId }] = await tx
          .insert(programs)
          .values({ ...values, companyId: ctx.companyId })
          .returning({ id: programs.id });
      }
      await tx.insert(programItems).values(items.map((i) => ({ ...i, programId: programId! })));
    });
    revalidatePath("/catalogo");
  });
}

export async function toggleProgram(id: string, active: boolean) {
  const ctx = await getContext();
  assertCan(ctx, "catalog.manage");
  await db.update(programs).set({ active }).where(and(eq(programs.id, id), eq(programs.companyId, ctx.companyId)));
  revalidatePath("/catalogo");
}
