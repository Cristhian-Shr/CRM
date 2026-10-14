import { asc, eq } from "drizzle-orm";
import { CalendarClock, Coins, Users, Wallet } from "lucide-react";
import { Modal } from "@/components/modal";
import { PageHeader, StatCard, Empty } from "@/components/ui";
import { Money } from "@/components/values-visibility";
import { db, schema } from "@/lib/db";
import { fmtDate, todayISO } from "@/lib/utils";
import { COMPANY_SERVICES, billingLabel, monthlyEquivalentCents, serviceMeta } from "@/lib/services";
import { PaymentManager } from "./payment-manager";

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
      soldAt: schema.companyServices.createdAt,
    })
    .from(schema.companyServices)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.companyServices.companyId))
    .orderBy(schema.companies.name);

  // Agenda de pagamentos de cada venda (empresa + serviço), para os modais.
  const allPayments = await db
    .select({
      id: schema.servicePayments.id,
      companyId: schema.servicePayments.companyId,
      service: schema.servicePayments.service,
      dueDate: schema.servicePayments.dueDate,
      valueCents: schema.servicePayments.valueCents,
      status: schema.servicePayments.status,
    })
    .from(schema.servicePayments)
    .orderBy(asc(schema.servicePayments.dueDate));
  const paymentsByKey = new Map<string, typeof allPayments>();
  for (const p of allPayments) {
    const key = `${p.companyId}|${p.service}`;
    const list = paymentsByKey.get(key) ?? [];
    list.push(p);
    paymentsByKey.set(key, list);
  }
  const today = todayISO();

  // Só empresas ativas contam na receita.
  const active = rows.filter((r) => r.status === "active");

  const perService = COMPANY_SERVICES.map((s) => {
    const items = active.filter((r) => r.service === s.key);
    // MRR = valor mensal equivalente de TODAS as recorrências (mensal/trimestral/semestral/anual).
    const mrr = items.filter((i) => i.billing !== "one_time").reduce((a, i) => a + monthlyEquivalentCents(i.valueCents, i.billing), 0);
    const oneTime = items.filter((i) => i.billing === "one_time").reduce((a, i) => a + i.valueCents, 0);
    return { ...s, companies: items.length, mrr, oneTime };
  });

  const totalMrr = perService.reduce((a, s) => a + s.mrr, 0);
  const totalOneTime = perService.reduce((a, s) => a + s.oneTime, 0);
  const clients = new Set(active.map((r) => r.companyId)).size;
  const maxTotal = Math.max(1, ...perService.map((s) => s.mrr + s.oneTime));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Vendas" subtitle="Receita dos seus serviços (empresas ativas)" />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Receita mensal (MRR)" value={<><Money value={totalMrr} />/mês</>} icon={CalendarClock} tone="green" />
        <StatCard label="Receita única" value={<Money value={totalOneTime} />} icon={Coins} />
        <StatCard label="Clientes com serviço" value={clients} icon={Users} />
      </div>

      <div className="card mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold tracking-[0.12em] text-muted uppercase">Por serviço</h2>
        <div className="space-y-3">
          {perService.map((s) => {
            const meta = serviceMeta(s.key);
            return (
              <div key={s.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted">
                    {s.mrr > 0 && <strong className="text-ink"><Money value={s.mrr} />/mês</strong>}
                    {s.mrr > 0 && s.oneTime > 0 && " · "}
                    {s.oneTime > 0 && <><Money value={s.oneTime} /> único</>}
                    {s.mrr === 0 && s.oneTime === 0 && "—"}
                    {"  ·  "}
                    {s.companies} {s.companies === 1 ? "empresa" : "empresas"}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-canvas">
                  <div
                    className={`h-full rounded-full ${meta?.bar ?? "bg-brand-500"}`}
                    style={{ width: `${Math.round(((s.mrr + s.oneTime) / maxTotal) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">As barras representam o peso de cada serviço na receita total (mensal + único).</p>
      </div>

      <div className="card min-h-0 flex-1 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Serviço</th>
              <th>Cobrança</th>
              <th>Data da venda</th>
              <th className="text-right">Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const payments = paymentsByKey.get(`${r.companyId}|${r.service}`) ?? [];
              const serviceLabel = serviceMeta(r.service)?.label ?? r.service;
              return (
                <tr key={`${r.companyId}-${r.service}-${i}`}>
                  <td className="font-medium">
                    {r.companyName}
                    {r.status !== "active" && <span className="ml-2 badge bg-amber-50 text-amber-700">suspensa</span>}
                  </td>
                  <td>{serviceLabel}</td>
                  <td>{billingLabel(r.billing)}</td>
                  <td className="text-muted">{fmtDate(r.soldAt)}</td>
                  <td className="text-right"><Money value={r.valueCents} /></td>
                  <td className="text-right">
                    <Modal
                      title={`Pagamentos · ${r.companyName} · ${serviceLabel}`}
                      trigger={
                        <>
                          <Wallet className="size-3.5" /> Pagamentos
                          {payments.length > 0 && <span className="ml-1 text-muted">({payments.length})</span>}
                        </>
                      }
                      triggerClassName="btn-ghost text-xs"
                    >
                      <PaymentManager
                        companyId={r.companyId}
                        service={r.service}
                        defaultValueCents={r.valueCents}
                        billing={r.billing}
                        today={today}
                        payments={payments}
                      />
                    </Modal>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-4">
            <Empty>Nenhum serviço cadastrado ainda. Marque os serviços de uma empresa em Empresas.</Empty>
          </div>
        )}
      </div>
    </div>
  );
}
