import { eq, sql } from "drizzle-orm";
import { Clock, Coins, Users, Wallet } from "lucide-react";
import { AutoSubmitInput } from "@/components/auto-submit";
import { Empty, PageHeader, StatCard } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { money, monthLabel, todayISO, ucfirst } from "@/lib/utils";
import { billingLabel, serviceMeta } from "@/lib/services";
import { setChargeStatus } from "@/server/actions/master";
import { ensureChargesForMonth } from "@/server/charges";

export const metadata = { title: "Faturamento" };

export default async function MasterFaturamentoPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes } = await searchParams;
  const month = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : todayISO().slice(0, 7);

  // Gera as cobranças do mês automaticamente (idempotente) ao abrir.
  await ensureChargesForMonth(month);

  const charges = await db
    .select({
      id: schema.serviceCharges.id,
      companyName: schema.companies.name,
      service: schema.serviceCharges.service,
      billing: schema.serviceCharges.billing,
      valueCents: schema.serviceCharges.valueCents,
      status: schema.serviceCharges.status,
    })
    .from(schema.serviceCharges)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.serviceCharges.companyId))
    .where(eq(schema.serviceCharges.competence, month))
    .orderBy(schema.companies.name);

  const recebido = charges.filter((c) => c.status === "paid").reduce((a, c) => a + c.valueCents, 0);
  const aReceber = charges.filter((c) => c.status !== "paid").reduce((a, c) => a + c.valueCents, 0);
  const faturamento = recebido + aReceber;

  const [{ ativos }] = await db
    .select({ ativos: sql<number>`count(distinct ${schema.companyServices.companyId})::int` })
    .from(schema.companyServices)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.companyServices.companyId))
    .where(eq(schema.companies.status, "active"));

  return (
    <>
      <PageHeader
        title="Faturamento"
        subtitle={<span>Recebido e a receber · {ucfirst(monthLabel(month))}</span>}
        actions={
          <form>
            <AutoSubmitInput type="month" name="mes" defaultValue={month} className="input w-44" />
          </form>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Recebido" value={money(recebido)} icon={Wallet} tone="green" />
        <StatCard label="A receber" value={money(aReceber)} icon={Clock} tone="amber" />
        <StatCard label="Faturamento do mês" value={money(faturamento)} icon={Coins} />
        <StatCard label="Clientes ativos" value={ativos} icon={Users} />
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Serviço</th>
              <th>Cobrança</th>
              <th className="text-right">Valor</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.companyName}</td>
                <td>{serviceMeta(c.service)?.label ?? c.service}</td>
                <td>{billingLabel(c.billing)}</td>
                <td className="text-right">{money(c.valueCents)}</td>
                <td>
                  <span className={`badge ${c.status === "paid" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                    {c.status === "paid" ? "Recebido" : "A receber"}
                  </span>
                </td>
                <td className="text-right">
                  <form action={setChargeStatus.bind(null, c.id, c.status === "paid" ? "pending" : "paid")}>
                    <button className="btn-ghost text-xs">{c.status === "paid" ? "Reabrir" : "Marcar pago"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {charges.length === 0 && (
          <div className="p-4">
            <Empty>
              Nenhuma cobrança em {ucfirst(monthLabel(month))}. Marque serviços com valor nas empresas (em Empresas → Serviços) para
              elas aparecerem aqui.
            </Empty>
          </div>
        )}
      </div>
    </>
  );
}
