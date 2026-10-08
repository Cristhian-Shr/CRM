import { eq, sql } from "drizzle-orm";
import { DollarSign, Eye, MousePointerClick, UserPlus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Empty, PageHeader, StatCard } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { can } from "@/lib/permissions";
import { cn, fmtDateTime, money, todayISO } from "@/lib/utils";
import { syncMetaNow } from "@/server/actions/campaigns";

export const metadata = { title: "Campanhas Meta" };

const PERIODS: Record<string, number> = { "7": 7, "14": 14, "30": 30 };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ dias?: string; todas?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, "campaigns.view")) redirect("/dashboard");
  const sp = await searchParams;
  const days = PERIODS[sp.dias ?? "7"] ?? 7;
  const since = todayISO(undefined, new Date(Date.now() - (days - 1) * 86_400_000));

  const conns = await db.select().from(schema.metaConnections).where(eq(schema.metaConnections.companyId, ctx.companyId));
  if (!conns.length)
    return (
      <>
        <PageHeader title="Campanhas Meta" />
        <Empty>
          Conecte a conta de anúncios da Meta em{" "}
          <Link href="/configuracoes/integracoes" className="text-brand-600 underline">
            Configurações → Integrações
          </Link>{" "}
          para ver investimento, leads e retorno de cada campanha.
        </Empty>
      </>
    );

  // Números da Meta + cruzamento com o CRM (leads que entraram, agendaram, fecharam e faturamento)
  const rows = await db.execute(sql`
    select c.meta_campaign_id, c.name, c.status, c.objective, c.daily_budget_cents,
      coalesce(sum(i.spend_cents),0)::bigint as spend,
      coalesce(sum(i.impressions),0)::bigint as impressions,
      coalesce(sum(i.clicks),0)::bigint as clicks,
      coalesce(sum(i.leads),0)::bigint as meta_leads,
      coalesce(sum(i.messages_started),0)::bigint as messages,
      (select count(*) from contacts ct where ct.company_id = c.company_id and ct.deleted_at is null
         and ct.meta_campaign_id = c.meta_campaign_id) as crm_leads,
      (select count(distinct a.contact_id) from appointments a join contacts ct on ct.id = a.contact_id
         where ct.company_id = c.company_id and ct.meta_campaign_id = c.meta_campaign_id) as scheduled,
      (select count(*) from deals d join contacts ct on ct.id = d.contact_id
         where ct.company_id = c.company_id and ct.meta_campaign_id = c.meta_campaign_id and d.won_at is not null) as won,
      (select coalesce(sum(o.total_cents),0) from orders o join contacts ct on ct.id = o.contact_id
         where ct.company_id = c.company_id and ct.meta_campaign_id = c.meta_campaign_id and o.status in ('confirmed','paid')) as revenue
    from meta_campaigns c
    left join meta_insights_daily i on i.company_id = c.company_id and i.meta_campaign_id = c.meta_campaign_id and i.date >= ${since}
    where c.company_id = ${ctx.companyId} ${sp.todas ? sql`` : sql`and c.status = 'ACTIVE'`}
    group by c.id
    order by spend desc, c.name
  `);
  const list = (rows.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.meta_campaign_id),
    name: String(r.name),
    status: String(r.status ?? ""),
    daily: r.daily_budget_cents == null ? null : Number(r.daily_budget_cents),
    spend: Number(r.spend),
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    metaLeads: Number(r.meta_leads) + Number(r.messages),
    crmLeads: Number(r.crm_leads),
    scheduled: Number(r.scheduled),
    won: Number(r.won),
    revenue: Number(r.revenue),
  }));
  const tot = list.reduce(
    (s, c) => ({ spend: s.spend + c.spend, impressions: s.impressions + c.impressions, clicks: s.clicks + c.clicks, leads: s.leads + c.metaLeads }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0 },
  );
  const nf = new Intl.NumberFormat("pt-BR");
  const lastSync = conns.map((c) => c.lastSyncAt).filter(Boolean).sort().at(-1);
  const errors = conns.filter((c) => c.lastError);

  return (
    <>
      <PageHeader
        title="Campanhas Meta"
        subtitle={`Últimos ${days} dias · ${lastSync ? `atualizado em ${fmtDateTime(lastSync)}` : "ainda não sincronizado"}`}
        actions={
          <>
            <div className="flex rounded-xl border border-line bg-surface p-1">
              {Object.keys(PERIODS).map((k) => (
                <Link key={k} href={`?dias=${k}${sp.todas ? "&todas=1" : ""}`} className={cn("rounded-lg px-3 py-1 text-sm", String(days) === k ? "bg-brand-500 text-white" : "text-muted")}>
                  {k} dias
                </Link>
              ))}
            </div>
            <Link href={sp.todas ? `?dias=${days}` : `?dias=${days}&todas=1`} className="btn-secondary">
              {sp.todas ? "Só ativas" : "Ver todas"}
            </Link>
            <ActionButton action={syncMetaNow} className="btn-primary">
              Atualizar agora
            </ActionButton>
          </>
        }
      />
      {errors.map((c) => (
        <p key={c.id} className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          Erro na conta {c.adAccountId}: {c.lastError}
        </p>
      ))}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Investimento" value={money(tot.spend)} icon={DollarSign} />
        <StatCard label="Impressões" value={nf.format(tot.impressions)} icon={Eye} />
        <StatCard label="Cliques" value={nf.format(tot.clicks)} icon={MousePointerClick} />
        <StatCard label="Leads (Meta)" value={nf.format(tot.leads)} icon={UserPlus} hint={tot.leads ? `CPL ${money(Math.round(tot.spend / tot.leads))}` : undefined} />
      </div>
      {list.length === 0 ? (
        <Empty>Nenhuma campanha {sp.todas ? "" : "ativa "}encontrada. Clique em “Atualizar agora”.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Campanha</th>
                <th className="text-right">Investido</th>
                <th className="text-right">Cliques</th>
                <th className="text-right">Leads Meta</th>
                <th className="text-right">CPL</th>
                <th className="text-right">Leads CRM</th>
                <th className="text-right">Agendaram</th>
                <th className="text-right">Fecharam</th>
                <th className="text-right">Faturamento</th>
                <th className="text-right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted">
                      {c.status === "ACTIVE" ? "Ativa" : c.status}
                      {c.daily ? ` · ${money(c.daily)}/dia` : ""}
                    </div>
                  </td>
                  <td className="text-right">{money(c.spend)}</td>
                  <td className="text-right">{nf.format(c.clicks)}</td>
                  <td className="text-right">{c.metaLeads}</td>
                  <td className="text-right">{c.metaLeads ? money(Math.round(c.spend / c.metaLeads)) : "—"}</td>
                  <td className="text-right">{c.crmLeads}</td>
                  <td className="text-right">{c.scheduled}</td>
                  <td className="text-right font-semibold text-green-600">{c.won}</td>
                  <td className="text-right">{money(c.revenue)}</td>
                  <td className="text-right font-semibold">{c.spend ? `${(c.revenue / c.spend).toFixed(1)}x` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-3 text-xs text-muted">
            Leads, agendamentos, fechamentos e faturamento vêm do CRM (leads com a campanha registrada pelo formulário da Meta). ROAS = faturamento ÷ investimento.
          </p>
        </div>
      )}
    </>
  );
}
