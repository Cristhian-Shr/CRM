import { and, asc, eq, sql } from "drizzle-orm";
import { ArrowRight, Clock, Coins, TrendingUp } from "lucide-react";
import { Modal } from "@/components/modal";
import { AutoSubmitSelect } from "@/components/auto-submit";
import { Empty, PageHeader, StatCard } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { fmtISODate, money, monthLabel, todayISO, ucfirst } from "@/lib/utils";
import { billingLabel, serviceMeta } from "@/lib/services";
import { setPaymentStatus } from "@/server/actions/master";
import { PaymentsManager } from "../comandas/payments-manager";

export const metadata = { title: "Faturamento" };

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export default async function MasterFaturamentoPage({ searchParams }: { searchParams: Promise<{ m?: string; y?: string }> }) {
  const sp = await searchParams;
  const now = todayISO();
  const curY = Number(now.slice(0, 4));
  const curM = Number(now.slice(5, 7));
  const y = sp.y && /^\d{4}$/.test(sp.y) ? Number(sp.y) : curY;
  const m = sp.m && Number(sp.m) >= 1 && Number(sp.m) <= 12 ? Number(sp.m) : curM;
  const month = `${y}-${String(m).padStart(2, "0")}`;

  const payments = await db
    .select({
      id: schema.servicePayments.id,
      companyId: schema.servicePayments.companyId,
      companyName: schema.companies.name,
      service: schema.servicePayments.service,
      note: schema.servicePayments.note,
      dueDate: schema.servicePayments.dueDate,
      valueCents: schema.servicePayments.valueCents,
      status: schema.servicePayments.status,
      billing: schema.companyServices.billing,
    })
    .from(schema.servicePayments)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.servicePayments.companyId))
    .leftJoin(
      schema.companyServices,
      and(
        eq(schema.companyServices.companyId, schema.servicePayments.companyId),
        eq(schema.companyServices.service, schema.servicePayments.service),
      ),
    )
    .where(sql`to_char(service_payments.due_date, 'YYYY-MM') = ${month}`)
    .orderBy(asc(schema.companies.name), asc(schema.servicePayments.service), asc(schema.servicePayments.dueDate));

  type Row = (typeof payments)[number];
  const total = payments.reduce((a, p) => a + p.valueCents, 0);
  const recebido = payments.filter((p) => p.status === "paid").reduce((a, p) => a + p.valueCents, 0);
  const pendente = total - recebido;
  const progress = total > 0 ? (recebido / total) * 100 : 0;

  const byCompany = new Map<string, { name: string; companyId: string; rows: Row[] }>();
  for (const p of payments) {
    const g = byCompany.get(p.companyId) ?? { name: p.companyName, companyId: p.companyId, rows: [] };
    g.rows.push(p);
    byCompany.set(p.companyId, g);
  }

  // Todos os lançamentos (sem filtro de mês) + serviços, para o modal "Ver empresa" gerenciar os pagamentos.
  const allPays = await db
    .select({
      id: schema.servicePayments.id,
      companyId: schema.servicePayments.companyId,
      service: schema.servicePayments.service,
      note: schema.servicePayments.note,
      dueDate: schema.servicePayments.dueDate,
      valueCents: schema.servicePayments.valueCents,
      status: schema.servicePayments.status,
    })
    .from(schema.servicePayments)
    .orderBy(asc(schema.servicePayments.service), asc(schema.servicePayments.dueDate));
  const allPaysByCompany = new Map<string, typeof allPays>();
  for (const p of allPays) {
    const l = allPaysByCompany.get(p.companyId) ?? [];
    l.push(p);
    allPaysByCompany.set(p.companyId, l);
  }
  const svc = await db
    .select({
      companyId: schema.companyServices.companyId,
      service: schema.companyServices.service,
      installments: schema.companyServices.installments,
      valueCents: schema.companyServices.valueCents,
      billing: schema.companyServices.billing,
    })
    .from(schema.companyServices);
  const svcByCompany = new Map<string, { service: string; installments: number; valueCents: number; billing: string }[]>();
  for (const s of svc) {
    const l = svcByCompany.get(s.companyId) ?? [];
    l.push({ service: s.service, installments: s.installments, valueCents: s.valueCents, billing: s.billing });
    svcByCompany.set(s.companyId, l);
  }

  const years = [curY - 1, curY, curY + 1, curY + 2];

  return (
    <>
      <PageHeader title="Controle Financeiro" subtitle="Acompanhe os pagamentos dos serviços contratados por empresa." />

      <div className="card mb-6 flex flex-wrap items-end justify-between gap-4 p-4">
        <form className="flex items-end gap-3">
          <label className="block">
            <span className="label">Mês</span>
            <AutoSubmitSelect name="m" defaultValue={String(m)} className="input">
              {MONTHS.map((mm, i) => (
                <option key={i} value={i + 1}>
                  {mm}
                </option>
              ))}
            </AutoSubmitSelect>
          </label>
          <label className="block">
            <span className="label">Ano</span>
            <AutoSubmitSelect name="y" defaultValue={String(y)} className="input">
              {years.map((yy) => (
                <option key={yy} value={yy}>
                  {yy}
                </option>
              ))}
            </AutoSubmitSelect>
          </label>
        </form>
        <span className="text-sm text-muted">{ucfirst(monthLabel(month))}</span>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total em faturas" value={money(total)} icon={Coins} />
        <StatCard label="Pendente" value={money(pendente)} icon={Clock} tone="amber" />
        <StatCard label="Recebido" value={money(recebido)} icon={TrendingUp} tone="green" />
      </div>

      <div className="card mb-6 p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-muted">Progresso de recebimento</span>
          <span className="font-semibold text-green-600">{progress.toFixed(1)}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-canvas">
          <div className="h-full rounded-full bg-green-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {byCompany.size === 0 ? (
        <div className="card p-4">
          <Empty>Nenhum lançamento neste mês. Marque serviços com valor nas empresas para gerar a agenda de pagamentos.</Empty>
        </div>
      ) : (
        <div className="space-y-4">
          {[...byCompany.values()].map((g) => {
            const cPend = g.rows.filter((r) => r.status !== "paid").reduce((a, r) => a + r.valueCents, 0);
            const cRec = g.rows.filter((r) => r.status === "paid").reduce((a, r) => a + r.valueCents, 0);
            const svcMap = new Map<string, Row[]>();
            for (const r of g.rows) {
              const key = r.service === "extra" ? `extra|${r.note ?? ""}` : r.service;
              const l = svcMap.get(key) ?? [];
              l.push(r);
              svcMap.set(key, l);
            }
            return (
              <div key={g.companyId} className="card overflow-hidden p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
                  <h2 className="font-semibold">{g.name}</h2>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted">
                      Pendente: <strong className="text-amber-600">{money(cPend)}</strong>
                    </span>
                    <span className="text-muted">
                      Recebido: <strong className="text-green-600">{money(cRec)}</strong>
                    </span>
                    <Modal
                      title={`Pagamentos · ${g.name}`}
                      trigger={
                        <>
                          Ver empresa <ArrowRight className="size-3.5" />
                        </>
                      }
                      triggerClassName="inline-flex items-center gap-1 text-brand-500 hover:underline"
                      xl
                    >
                      <PaymentsManager
                        companyId={g.companyId}
                        payments={allPaysByCompany.get(g.companyId) ?? []}
                        services={svcByCompany.get(g.companyId) ?? []}
                        today={now}
                      />
                    </Modal>
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  {[...svcMap.entries()].map(([key, rows]) => {
                    const sPend = rows.filter((r) => r.status !== "paid").reduce((a, r) => a + r.valueCents, 0);
                    const sPaid = rows.filter((r) => r.status === "paid").reduce((a, r) => a + r.valueCents, 0);
                    const isExtra = rows[0].service === "extra";
                    const label = isExtra ? rows[0].note || "Extra" : serviceMeta(rows[0].service)?.label ?? rows[0].service;
                    const billing = rows[0].billing;
                    return (
                      <div key={key} className="rounded-xl border border-line p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="font-medium">
                            {label}
                            <span className="ml-2 text-muted">
                              {isExtra ? "Extra" : billing ? billingLabel(billing) : "—"} · {money(rows[0].valueCents)} / período
                            </span>
                          </span>
                          <span className="text-muted">
                            Pendente: <strong className="text-amber-600">{money(sPend)}</strong> · Pago:{" "}
                            <strong className="text-green-600">{money(sPaid)}</strong>
                          </span>
                        </div>
                        <div className="divide-y divide-line">
                          {rows.map((r) => (
                            <div key={r.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                              <span>
                                {fmtISODate(r.dueDate)} — <span className="tabular-nums">{money(r.valueCents)}</span>
                              </span>
                              <form action={setPaymentStatus.bind(null, r.id, r.status === "paid" ? "pending" : "paid")}>
                                <button
                                  className={
                                    r.status === "paid" ? "badge bg-green-50 text-green-700" : "badge bg-amber-50 text-amber-700"
                                  }
                                >
                                  {r.status === "paid" ? "Pago" : "Pendente"}
                                </button>
                              </form>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
