import { and, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { NewLeadButton } from "@/components/leads/new-lead";
import { Avatar, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { contactScope, listMembers, listStages } from "@/lib/db/tenant";
import { fmtDate, fmtPhone } from "@/lib/utils";

export const metadata = { title: "Leads / Clientes" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; origem?: string }> }) {
  const ctx = await getContext();
  const { q, status, origem } = await searchParams;
  const [members, stages, sources] = await Promise.all([
    listMembers(ctx.companyId),
    listStages(ctx.companyId),
    db.select().from(schema.leadSources).where(eq(schema.leadSources.companyId, ctx.companyId)),
  ]);

  const digits = q?.replace(/\D/g, "");
  const rows = await db
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      phone: schema.contacts.phone,
      email: schema.contacts.email,
      status: schema.contacts.status,
      createdAt: schema.contacts.createdAt,
      lastInteractionAt: schema.contacts.lastInteractionAt,
      owner: schema.users.name,
      ownerColor: schema.companyMembers.color,
      source: schema.leadSources.name,
      stage: sql<string | null>`(select s.name from deals d join pipeline_stages s on s.id = d.stage_id
        where d.contact_id = ${schema.contacts.id} and d.deleted_at is null order by d.updated_at desc limit 1)`,
    })
    .from(schema.contacts)
    .leftJoin(schema.companyMembers, eq(schema.companyMembers.id, schema.contacts.ownerId))
    .leftJoin(schema.users, eq(schema.users.id, schema.companyMembers.userId))
    .leftJoin(schema.leadSources, eq(schema.leadSources.id, schema.contacts.sourceId))
    .where(
      and(
        contactScope(ctx),
        q
          ? sql`(${schema.contacts.name} ilike ${"%" + q + "%"} or ${schema.contacts.email} ilike ${"%" + q + "%"}
              ${digits ? sql`or ${schema.contacts.phone} like ${"%" + digits + "%"}` : sql``})`
          : undefined,
        status ? eq(schema.contacts.status, status) : undefined,
        origem ? eq(schema.contacts.sourceId, origem) : undefined,
      ),
    )
    .orderBy(desc(schema.contacts.createdAt))
    .limit(300);

  return (
    <>
      <PageHeader
        title="Leads / Clientes"
        subtitle={`${rows.length} cadastros${rows.length === 300 ? " (mostrando os 300 mais recentes)" : ""}`}
        actions={
          <NewLeadButton
            members={members.filter((m) => m.active)}
            sources={sources}
            stages={stages.filter((s) => s.kind === "open")}
            defaultOwner={ctx.memberId}
          />
        }
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Buscar por nome, telefone ou e-mail" className="input max-w-sm" autoFocus />
        <select name="status" defaultValue={status ?? ""} className="input w-40">
          <option value="">Todos os status</option>
          <option value="lead">Lead</option>
          <option value="client">Cliente</option>
          <option value="inactive">Inativo</option>
        </select>
        <select name="origem" defaultValue={origem ?? ""} className="input w-44">
          <option value="">Todas as origens</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn-secondary">Filtrar</button>
      </form>
      {rows.length === 0 ? (
        <Empty>Nenhum cadastro encontrado.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone</th>
                <th>Status</th>
                <th>Etapa</th>
                <th>Origem</th>
                <th>Responsável</th>
                <th>Cadastro</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-brand-50/50">
                  <td>
                    <Link href={`/clientes/${r.id}`} className="font-medium hover:text-brand-600">
                      {r.name}
                    </Link>
                    {r.email && <div className="text-xs text-muted">{r.email}</div>}
                  </td>
                  <td>{fmtPhone(r.phone)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="text-muted">{r.stage ?? "—"}</td>
                  <td className="text-muted">{r.source ?? "—"}</td>
                  <td>
                    {r.owner ? (
                      <span className="flex items-center gap-2">
                        <Avatar name={r.owner} color={r.ownerColor} size="sm" /> {r.owner}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-muted">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
