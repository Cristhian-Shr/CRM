import { asc, desc, sql } from "drizzle-orm";
import { Wallet } from "lucide-react";
import Link from "next/link";
import { Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { Empty, PageHeader } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { fmtISODate, money, todayISO } from "@/lib/utils";
import { billingLabel, monthlyEquivalentCents, paymentMethodLabel, serviceMeta, type CompanyService } from "@/lib/services";
import { setCompanyServices } from "@/server/actions/master";
import { ServicesPicker } from "../services-picker";
import { PaymentsManager } from "./payments-manager";

export const metadata = { title: "Comandas" };

export default async function MasterComandasPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const { empresa } = await searchParams;
  const allCompanies = await db
    .select({
      id: schema.companies.id,
      name: schema.companies.name,
      status: schema.companies.status,
      paymentMethod: schema.companies.paymentMethod,
      services: sql<CompanyService[]>`coalesce((
        select json_agg(json_build_object('service', cs.service, 'valueCents', cs.value_cents, 'billing', cs.billing, 'installments', cs.installments) order by cs.service)
        from company_services cs where cs.company_id = companies.id
      ), '[]'::json)`,
    })
    .from(schema.companies)
    .orderBy(desc(schema.companies.createdAt));

  // Lançamentos de cada empresa, para o modal de Pagamentos da comanda.
  const pays = await db
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
  const paysByCompany = new Map<string, typeof pays>();
  for (const p of pays) {
    const l = paysByCompany.get(p.companyId) ?? [];
    l.push(p);
    paysByCompany.set(p.companyId, l);
  }

  // Filtro por empresa (ex.: vindo de "Ver empresa" no Faturamento).
  const companies = empresa ? allCompanies.filter((c) => c.id === empresa) : allCompanies;

  return (
    <>
      <PageHeader title="Comandas" subtitle="Contrato de cada empresa: serviços, recorrência e forma de pagamento" />

      {empresa && (
        <div className="mb-4">
          <Link href="/master/comandas" className="text-sm text-brand-500 hover:underline">
            ← Ver todas as empresas
          </Link>
        </div>
      )}

      {companies.length === 0 ? (
        <div className="card p-4">
          <Empty>{empresa ? "Empresa não encontrada." : "Nenhuma empresa cadastrada ainda."}</Empty>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {companies.map((c) => {
            const mrr = c.services
              .filter((s) => s.billing !== "one_time")
              .reduce((a, s) => a + monthlyEquivalentCents(s.valueCents, s.billing), 0);
            const oneTime = c.services.filter((s) => s.billing === "one_time").reduce((a, s) => a + s.valueCents, 0);
            return (
              <div key={c.id} className="card p-5">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">
                      {c.name}
                      {c.status !== "active" && <span className="ml-2 badge bg-amber-50 text-amber-700">suspensa</span>}
                    </h2>
                    <p className="text-xs text-muted">
                      Forma de pagamento: <span className="text-ink">{paymentMethodLabel(c.paymentMethod)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Modal
                      title={`Pagamentos · ${c.name}`}
                      trigger={
                        <>
                          <Wallet className="size-3.5" /> Pagamentos
                        </>
                      }
                      triggerClassName="btn-ghost text-xs"
                      xl
                    >
                      <PaymentsManager
                        companyId={c.id}
                        payments={paysByCompany.get(c.id) ?? []}
                        services={c.services.map((s) => ({
                          service: s.service,
                          installments: s.installments,
                          valueCents: s.valueCents,
                          billing: s.billing,
                        }))}
                        today={todayISO()}
                      />
                    </Modal>
                    <Modal title={`Comanda · ${c.name}`} trigger="Editar" triggerClassName="btn-ghost text-xs" wide>
                      <Form action={setCompanyServices.bind(null, c.id)}>
                        <ServicesPicker current={c.services} paymentMethod={c.paymentMethod} />
                        <Submit>Salvar comanda</Submit>
                      </Form>
                    </Modal>
                  </div>
                </div>

                {c.services.length > 0 ? (
                  <div className="divide-y divide-line rounded-xl border border-line">
                    {c.services.map((s) => (
                      <div key={s.service} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>{serviceMeta(s.service)?.label ?? s.service}</span>
                        <span className="text-muted">
                          <strong className="text-ink">{money(s.valueCents)}</strong> · {billingLabel(s.billing)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">Nenhum serviço nesta comanda.</p>
                )}

                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-muted">Total</span>
                  <span className="text-muted">
                    {mrr > 0 && <strong className="text-ink">{money(mrr)}/mês</strong>}
                    {mrr > 0 && oneTime > 0 && " · "}
                    {oneTime > 0 && <span>{money(oneTime)} único</span>}
                    {mrr === 0 && oneTime === 0 && "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
