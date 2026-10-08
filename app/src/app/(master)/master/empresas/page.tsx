import { desc, sql } from "drizzle-orm";
import { LogIn, Trash2 } from "lucide-react";
import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { MoneyInput } from "@/components/money-input";
import { PageHeader } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { centsToInput, fmtDate, money } from "@/lib/utils";
import { COMPANY_SERVICES, SERVICE_BILLINGS, serviceMeta, type CompanyService } from "@/lib/services";
import { createCompany, deleteCompany, enterCompany, setCompanyServices, setCompanyStatus } from "@/server/actions/master";

export const metadata = { title: "Empresas" };

function ServicesPicker({ current }: { current?: CompanyService[] }) {
  return (
    <fieldset>
      <span className="label">Serviços contratados</span>
      <div className="mt-1 space-y-2">
        {COMPANY_SERVICES.map((s) => {
          const cur = current?.find((c) => c.service === s.key);
          return (
            <div key={s.key} className="grid grid-cols-[1fr_7rem_6rem] items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={`svc_${s.key}`}
                  defaultChecked={!!cur}
                  className="size-4 rounded accent-brand-500"
                />
                {s.label}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">R$</span>
                <MoneyInput name={`value_${s.key}`} defaultValue={cur ? centsToInput(cur.valueCents) : ""} className="input pl-7" />
              </div>
              <select name={`billing_${s.key}`} defaultValue={cur?.billing ?? "monthly"} className="input">
                {SERVICE_BILLINGS.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function ServiceBadges({ services }: { services: CompanyService[] }) {
  if (!services.length) return <span className="text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {services.map((cs) => {
        const m = serviceMeta(cs.service);
        return m ? (
          <span
            key={cs.service}
            className={`badge ${m.badge}`}
            title={`${money(cs.valueCents)} · ${cs.billing === "monthly" ? "mensal" : "único"}`}
          >
            {m.short}
          </span>
        ) : null;
      })}
    </div>
  );
}

export default async function MasterCompaniesPage() {
  const companies = await db
    .select({
      id: schema.companies.id,
      name: schema.companies.name,
      plan: schema.companies.plan,
      status: schema.companies.status,
      services: sql<CompanyService[]>`coalesce((
        select json_agg(json_build_object('service', cs.service, 'valueCents', cs.value_cents, 'billing', cs.billing) order by cs.service)
        from company_services cs where cs.company_id = ${schema.companies.id}
      ), '[]'::json)`,
      createdAt: schema.companies.createdAt,
      members: sql<number>`(select count(*)::int from company_members m where m.company_id = ${schema.companies.id} and m.active)`,
      contacts: sql<number>`(select count(*)::int from contacts c where c.company_id = ${schema.companies.id} and c.deleted_at is null)`,
    })
    .from(schema.companies)
    .orderBy(desc(schema.companies.createdAt));

  return (
    <>
      <PageHeader
        title="Empresas"
        subtitle="Clínicas que usam o CRM"
        actions={
          <Modal title="Nova empresa" trigger="+ Nova empresa">
            <Form action={createCompany}>
              <Field label="Nome da clínica">
                <input name="name" required className="input" placeholder="Clínica Bella" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="CNPJ">
                  <input name="cnpj" className="input" />
                </Field>
                <Field label="Telefone">
                  <input name="phone" className="input" />
                </Field>
              </div>
              <Field label="Plano">
                <select name="plan" className="input">
                  <option value="basic">Básico</option>
                  <option value="pro">Pro</option>
                </select>
              </Field>
              <ServicesPicker />
              <div className="rounded-xl bg-brand-50 p-3 text-xs text-brand-700">Primeiro administrador da clínica</div>
              <Field label="Nome do admin">
                <input name="adminName" required className="input" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="E-mail do admin">
                  <input name="adminEmail" type="email" required className="input" />
                </Field>
                <Field label="Senha inicial">
                  <input name="adminPassword" type="text" minLength={8} required className="input" />
                </Field>
              </div>
              <Submit>Criar empresa</Submit>
            </Form>
          </Modal>
        }
      />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Plano</th>
              <th>Serviços</th>
              <th>Equipe</th>
              <th>Leads</th>
              <th>Desde</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td className="uppercase">{c.plan}</td>
                <td>
                  <ServiceBadges services={c.services} />
                </td>
                <td>{c.members}</td>
                <td>{c.contacts}</td>
                <td>{fmtDate(c.createdAt)}</td>
                <td>
                  <span className={`badge ${c.status === "active" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                    {c.status === "active" ? "Ativa" : "Suspensa"}
                  </span>
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    <Modal title={`Serviços · ${c.name}`} trigger="Serviços" triggerClassName="btn-ghost text-xs" wide>
                      <Form action={setCompanyServices.bind(null, c.id)}>
                        <ServicesPicker current={c.services} />
                        <Submit>Salvar</Submit>
                      </Form>
                    </Modal>
                    <form action={setCompanyStatus.bind(null, c.id, c.status === "active" ? "suspended" : "active")}>
                      <button className="btn-ghost text-xs">{c.status === "active" ? "Suspender" : "Reativar"}</button>
                    </form>
                    <form action={enterCompany.bind(null, c.id)}>
                      <button className="btn-secondary text-xs">
                        <LogIn className="size-3.5" /> Entrar como empresa
                      </button>
                    </form>
                    <Modal
                      title={`Excluir ${c.name}`}
                      trigger={
                        <>
                          <Trash2 className="size-3.5" /> Excluir
                        </>
                      }
                      triggerClassName="btn-ghost text-xs text-red-600 hover:text-red-700"
                    >
                      <Form action={deleteCompany.bind(null, c.id)}>
                        <p className="text-sm text-muted">
                          Isso apaga <b className="text-ink">{c.name}</b> e <b className="text-ink">todos os dados</b> dela (equipe,
                          leads, funil, agenda, pedidos e cobranças). Esta ação é <b className="text-ink">irreversível</b>.
                        </p>
                        <Field label={`Digite "${c.name}" para confirmar`}>
                          <input name="confirm" required autoComplete="off" className="input" placeholder={c.name} />
                        </Field>
                        <Submit className="btn-danger">Excluir definitivamente</Submit>
                      </Form>
                    </Modal>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
