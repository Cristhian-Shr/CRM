import { eq, sql } from "drizzle-orm";
import { ArrowRight, Building2, Clock, Coins, Wallet } from "lucide-react";
import Link from "next/link";
import { PageHeader, StatCard } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { money, monthLabel, todayISO, ucfirst } from "@/lib/utils";
import { COMPANY_SERVICES, serviceMeta } from "@/lib/services";
import { ensureChargesForMonth } from "@/server/charges";

export const metadata = { title: "Início" };

export default async function MasterHomePage() {
  const month = todayISO().slice(0, 7);
  // Garante as cobranças do mês atual para os números baterem.
  await ensureChargesForMonth(month);

  const charges = await db
    .select({ status: schema.serviceCharges.status, valueCents: schema.serviceCharges.valueCents })
    .from(schema.serviceCharges)
    .where(eq(schema.serviceCharges.competence, month));
  const recebido = charges.filter((c) => c.status === "paid").reduce((a, c) => a + c.valueCents, 0);
  const aReceber = charges.filter((c) => c.status !== "paid").reduce((a, c) => a + c.valueCents, 0);
  const faturamento = recebido + aReceber;

  const [{ ativas }] = await db
    .select({ ativas: sql<number>`count(*)::int` })
    .from(schema.companies)
    .where(eq(schema.companies.status, "active"));

  // Resumo por serviço (MRR dos serviços mensais de empresas ativas).
  const svc = await db
    .select({
      service: schema.companyServices.service,
      valueCents: schema.companyServices.valueCents,
      billing: schema.companyServices.billing,
    })
    .from(schema.companyServices)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.companyServices.companyId))
    .where(eq(schema.companies.status, "active"));
  const perService = COMPANY_SERVICES.map((s) => ({
    ...s,
    mrr: svc.filter((r) => r.service === s.key && r.billing === "monthly").reduce((a, r) => a + r.valueCents, 0),
  }));
  const maxMrr = Math.max(1, ...perService.map((s) => s.mrr));

  return (
    <>
      <PageHeader title="Início" subtitle={<span>Visão geral · {ucfirst(monthLabel(month))}</span>} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Faturamento do mês" value={money(faturamento)} icon={Coins} />
        <StatCard label="Recebido do mês" value={money(recebido)} icon={Wallet} tone="green" />
        <StatCard label="A receber do mês" value={money(aReceber)} icon={Clock} tone="amber" />
        <StatCard label="Empresas ativas" value={ativas} icon={Building2} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold tracking-[0.12em] text-muted uppercase">Receita mensal por serviço</h2>
          <div className="space-y-4">
            {perService.map((s) => {
              const meta = serviceMeta(s.key);
              return (
                <div key={s.key}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{s.label}</span>
                    <span className="text-muted">{s.mrr > 0 ? <strong className="text-ink">{money(s.mrr)}/mês</strong> : "—"}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-canvas">
                    <div
                      className={`h-full rounded-full ${meta?.bar ?? "bg-brand-500"}`}
                      style={{ width: `${Math.round((s.mrr / maxMrr) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card flex flex-col gap-3 p-5">
          <h2 className="text-sm font-semibold tracking-[0.12em] text-muted uppercase">Atalhos</h2>
          <Link href="/master/faturamento" className="btn-secondary justify-between">
            Faturamento do mês <ArrowRight className="size-4" />
          </Link>
          <Link href="/master/vendas" className="btn-secondary justify-between">
            Vendas por serviço <ArrowRight className="size-4" />
          </Link>
          <Link href="/master/empresas" className="btn-secondary justify-between">
            Empresas <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </>
  );
}
