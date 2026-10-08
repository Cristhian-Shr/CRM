import { and, eq, sql } from "drizzle-orm";
import { NewLeadButton } from "@/components/leads/new-lead";
import { PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { dealScope, listMembers, listStages } from "@/lib/db/tenant";
import { Board, type BoardDeal } from "./board";

export const metadata = { title: "Funil de Vendas" };

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ resp?: string; q?: string }> }) {
  const ctx = await getContext();
  const { resp, q } = await searchParams;
  const [stages, members, sources, lossReasons] = await Promise.all([
    listStages(ctx.companyId),
    listMembers(ctx.companyId),
    db.select().from(schema.leadSources).where(eq(schema.leadSources.companyId, ctx.companyId)),
    db.select().from(schema.lossReasons).where(eq(schema.lossReasons.companyId, ctx.companyId)),
  ]);

  const rows = await db
    .select({
      id: schema.deals.id,
      title: schema.deals.title,
      valueCents: schema.deals.valueCents,
      stageId: schema.deals.stageId,
      position: schema.deals.position,
      stageEnteredAt: schema.deals.stageEnteredAt,
      contactId: schema.contacts.id,
      contactName: schema.contacts.name,
      phone: schema.contacts.phone,
      ownerName: schema.users.name,
      ownerColor: schema.companyMembers.color,
      nextTaskAt: sql<string | null>`(select min(t.due_at) from tasks t where t.contact_id = ${schema.contacts.id} and t.status = 'pending')`,
    })
    .from(schema.deals)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.deals.contactId))
    .leftJoin(schema.companyMembers, eq(schema.companyMembers.id, schema.deals.ownerId))
    .leftJoin(schema.users, eq(schema.users.id, schema.companyMembers.userId))
    .where(
      and(
        dealScope(ctx),
        resp ? eq(schema.deals.ownerId, resp) : undefined,
        q ? sql`(${schema.contacts.name} ilike ${"%" + q + "%"} or ${schema.contacts.phone} ilike ${"%" + q.replace(/\D/g, "") + "%"})` : undefined,
        // ganhos e perdidos somem do quadro depois de 30 dias
        sql`(coalesce(${schema.deals.wonAt}, ${schema.deals.lostAt}) is null or coalesce(${schema.deals.wonAt}, ${schema.deals.lostAt}) > now() - interval '30 days')`,
      ),
    )
    .orderBy(schema.deals.position);

  const deals: BoardDeal[] = rows.map((r) => ({
    ...r,
    stageEnteredAt: r.stageEnteredAt.toISOString(),
    nextTaskAt: r.nextTaskAt ? new Date(r.nextTaskAt).toISOString() : null,
  }));
  return (
    <>
      <PageHeader
        title="Funil de Vendas"
        subtitle={`${rows.length} ${rows.length === 1 ? "oportunidade" : "oportunidades"}`}
        actions={
          <>
            <form className="flex flex-wrap gap-2">
              <input name="q" defaultValue={q} placeholder="Buscar nome ou telefone" className="input w-52" />
              <select name="resp" defaultValue={resp ?? ""} className="input w-44">
                <option value="">Todos os responsáveis</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button className="btn-secondary">Filtrar</button>
            </form>
            <NewLeadButton
              members={members.filter((m) => m.active)}
              sources={sources}
              stages={stages.filter((s) => s.kind === "open")}
              defaultOwner={ctx.memberId}
            />
          </>
        }
      />
      <Board stages={stages} deals={deals} lossReasons={lossReasons.map((l) => ({ id: l.id, name: l.name }))} />
    </>
  );
}
