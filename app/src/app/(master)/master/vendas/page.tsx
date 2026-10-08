import { eq } from "drizzle-orm";
import { CalendarClock, Coins, Users } from "lucide-react";
import { PageHeader, StatCard, Empty } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { money } from "@/lib/utils";
import { COMPANY_SERVICES, billingLabel, serviceMeta } from "@/lib/services";

export const metadata = { title: "Vendas" };

export default async function MasterVendasPage() {
  const rows = await db
    .select({
      companyId: schema.companyServices.companyId,
      companyName: schema.companies.name,
      status: schema.companies.status,
      service: schema.companyServices.service,
      valueCents: schema.companyServices.valueCents,
      billing: schema.companyServices.billing,
    })
    .from(schema.companyServices)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.companyServices.companyId))
    .orderBy(schema.companies.name);

  // Só empresas ativas contam na receita.
  const active = rows.filter((r) => r.status === "active");

  const perService = COMPANY_SERVICES.map((s) => {
    const items = active.filter((r) => r.service === s.key);
    const mrr = items.filter((i) => i.billing === "monthly").reduce((a, i) => a + i.valueCents, 0);
    const oneTime = items.filter((i) => i.billing === "one_time").reduce((a, i) => a + i.valueCents, 0);
    return { ...s, companies: items.length, mrr, oneTime };
  });

  const totalMrr = perService.reduce((a, s) => a + s.mrr, 0);
  const totalOneTime = perService.reduce((a, s) => a + s.oneTime, 0);
  const clients = new Set(active.map((r) => r.companyId)).size;
  const maxMrr = Math.max(1, ...perService.map((s) => s.mrr));

  return (
    <>
      <PageHeader title="Vendas" subtitle="Receita dos seus serviços (empresas ativas)" />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Receita mensal (MRR)" value={`${money(totalMrr)}/mês`} icon={CalendarClock} tone="green" />
        <StatCard label="Receita única" value={money(totalOneTime)} icon={Coins} />
        <StatCard label="Clientes com serviço" value={clients} icon={Users} />
      </div>

      <div className="card mb-6 p-5">
        <h2 className="mb-4 text-sm font-semibold tracking-[0.12em] text-muted uppercase">Por serviço</h2>
        <div className="space-y-4">
          {perService.map((s) => {
            const meta = serviceMeta(s.key);
            return (
              <div key={s.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted">
                    {s.mrr > 0 && <strong className="text-ink">{money(s.mrr)}/mês</strong>}
                    {s.mrr > 0 && s.oneTime > 0 && " · "}
                    {s.oneTime > 0 && <>{money(s.oneTime)} único</>}
                    {s.mrr === 0 && s.oneTime === 0 && "—"}
                    {"  ·  "}
                    {s.companies} {s.companies === 1 ? "empresa" : "empresas"}
                  </span>
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
        <p className="mt-3 text-xs text-muted">As barras representam o peso de cada serviço na receita mensal (MRR).</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Serviço</th>
              <th>Cobrança</th>
              <th className="text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.companyId}-${r.service}-${i}`}>
                <td className="font-medium">
                  {r.companyName}
                  {r.status !== "active" && <span className="ml-2 badge bg-amber-50 text-amber-700">suspensa</span>}
                </td>
                <td>{serviceMeta(r.service)?.label ?? r.service}</td>
                <td>{billingLabel(r.billing)}</td>
                <td className="text-right">{money(r.valueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-4">
            <Empty>Nenhum serviço cadastrado ainda. Marque os serviços de uma empresa em Empresas.</Empty>
          </div>
        )}
      </div>
    </>
  );
}
