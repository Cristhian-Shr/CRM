import { desc, sql } from "drizzle-orm";
import { LogIn, Trash2 } from "lucide-react";
import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { CnpjInput, PhoneInput } from "@/components/masked-input";
import { PageHeader } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { fmtDate, money } from "@/lib/utils";
import { billingLabel, serviceMeta, type CompanyService } from "@/lib/services";
import { createCompany, deleteCompany, enterCompany, setCompanyServices, setCompanyStatus } from "@/server/actions/master";
import { ServicesPicker } from "../services-picker";

export const metadata = { title: "Empresas" };

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
            title={`${money(cs.valueCents)} · ${billingLabel(cs.billing)}`}
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
      paymentMethod: schema.companies.paymentMethod,
      status: schema.companies.status,
      services: sql<CompanyService[]>`coalesce((
        select json_agg(json_build_object('service', cs.service, 'valueCents', cs.value_cents, 'billing', cs.billing, 'installments', cs.installments) order by cs.service)
        from company_services cs where cs.company_id = companies.id
      ), '[]'::json)`,
      createdAt: schema.companies.createdAt,
      members: sql<number>`(select count(*)::int from company_members m where m.company_id = companies.id and m.active)`,
      contacts: sql<number>`(select count(*)::int from contacts c where c.company_id = companies.id and c.deleted_at is null)`,
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
                  <CnpjInput name="cnpj" />
                </Field>
                <Field label="Telefone">
                  <PhoneInput name="phone" />
                </Field>
              </div>
              <Field label="Plano">
                <select name="plan" className="input">
                  <option value="basic">Básico</option>
                  <option value="pro">Pro</option>
                </select>
              </Field>
              <ServicesPicker />
              <p className="text-xs text-muted">Os usuários desta empresa são cadastrados depois, em Usuários.</p>
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
                        <ServicesPicker current={c.services} paymentMethod={c.paymentMethod} />
                        <Submit>Salvar</Submit>
                      </Form>
                    </Modal>
                    <form action={setCompanyStatus.bind(null, c.id, c.status === "active" ? "suspended" : "active")}>
                      <button className="btn-ghost text-xs">{c.status === "active" ? "Suspender" : "Reativar"}</button>
                    </form>
                    {c.services.some((s) => s.service === "crm") && (
                      <form action={enterCompany.bind(null, c.id)}>
                        <button className="btn-secondary text-xs">
                          <LogIn className="size-3.5" /> Entrar como empresa
                        </button>
                      </form>
                    )}
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
