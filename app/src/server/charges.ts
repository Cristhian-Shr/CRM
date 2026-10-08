import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Cria as cobranças que faltam para o mês de competência ("AAAA-MM").
 * Idempotente: mensais geram 1 por mês; serviços de valor único geram 1 só vez.
 * Retorna quantas cobranças foram criadas.
 */
export async function ensureChargesForMonth(competence: string): Promise<number> {
  if (!/^\d{4}-\d{2}$/.test(competence)) return 0;

  const services = await db
    .select({
      companyId: schema.companyServices.companyId,
      service: schema.companyServices.service,
      valueCents: schema.companyServices.valueCents,
      billing: schema.companyServices.billing,
    })
    .from(schema.companyServices)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.companyServices.companyId))
    .where(eq(schema.companies.status, "active"));

  const existing = await db
    .select({
      companyId: schema.serviceCharges.companyId,
      service: schema.serviceCharges.service,
      competence: schema.serviceCharges.competence,
    })
    .from(schema.serviceCharges);
  const existMonth = new Set(existing.map((e) => `${e.companyId}|${e.service}|${e.competence}`));
  const existAny = new Set(existing.map((e) => `${e.companyId}|${e.service}`));

  const toCreate = services
    .filter((s) =>
      s.billing === "one_time"
        ? !existAny.has(`${s.companyId}|${s.service}`)
        : !existMonth.has(`${s.companyId}|${s.service}|${competence}`),
    )
    .map((s) => ({
      companyId: s.companyId,
      service: s.service,
      competence,
      valueCents: s.valueCents,
      billing: s.billing,
    }));

  if (toCreate.length) await db.insert(schema.serviceCharges).values(toCreate);
  return toCreate.length;
}
