import { sql } from "drizzle-orm";
import Link from "next/link";
import { Empty } from "@/components/ui";
import type { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { cn, money } from "@/lib/utils";
import { previousPeriod, resolvePeriod, type TrafegoSearch } from "@/lib/trafego";

type Ctx = Awaited<ReturnType<typeof getContext>>;
const nf = new Intl.NumberFormat("pt-BR");

export async function CampanhasTab({ ctx, sp }: { ctx: Ctx; sp: TrafegoSearch }) {
  const { since, until } = resolvePeriod(sp);
  const ativos = sp.ativos === "1";
  const campFilter = sp.campanha ? sql`and c.meta_campaign_id = ${sp.campanha}` : sql``;

  // (a) Resultado real no CRM (nível campanha)
  const crm = await db.execute(sql`
    select c.meta_campaign_id, c.name,
      coalesce(sum(i.spend_cents),0)::bigint as spend,
      coalesce(sum(i.leads + i.messages_started),0)::bigint as meta_leads,
      (select count(*) from contacts ct where ct.company_id = c.company_id and ct.deleted_at is null and ct.meta_campaign_id = c.meta_campaign_id) as crm_leads,
      (select count(distinct a.contact_id) from appointments a join contacts ct on ct.id = a.contact_id where ct.company_id = c.company_id and ct.meta_campaign_id = c.meta_campaign_id) as scheduled,
      (select count(distinct a.contact_id) from appointments a join contacts ct on ct.id = a.contact_id where ct.company_id = c.company_id and ct.meta_campaign_id = c.meta_campaign_id and a.status = 'done') as attended,
      (select count(*) from deals d join contacts ct on ct.id = d.contact_id where ct.company_id = c.company_id and ct.meta_campaign_id = c.meta_campaign_id and d.won_at is not null) as won,
      (select coalesce(sum(o.total_cents),0) from orders o join contacts ct on ct.id = o.contact_id where ct.company_id = c.company_id and ct.meta_campaign_id = c.meta_campaign_id and o.status in ('confirmed','paid')) as revenue
    from meta_campaigns c
    left join meta_insights_daily i on i.company_id = c.company_id and i.meta_campaign_id = c.meta_campaign_id and i.date >= ${since} and i.date <= ${until}
    where c.company_id = ${ctx.companyId} ${campFilter} ${sp.conta ? sql`and c.connection_id = ${sp.conta}` : sql``} ${ativos ? sql`and c.status = 'ACTIVE'` : sql``}
    group by c.id order by spend desc, c.name
  `);
  const crmRows = (crm.rows as Record<string, unknown>[])
    .map((r) => {
      const spend = Number(r.spend);
      const crmLeads = Number(r.crm_leads);
      const revenue = Number(r.revenue);
      return {
        id: String(r.meta_campaign_id),
        name: String(r.name),
        spend,
        metaLeads: Number(r.meta_leads),
        crmLeads,
        scheduled: Number(r.scheduled),
        attended: Number(r.attended),
        won: Number(r.won),
        revenue,
        cplReal: crmLeads ? Math.round(spend / crmLeads) : 0,
        roi: spend ? revenue / spend : 0,
      };
    })
    .filter((r) => r.spend > 0 || r.crmLeads > 0);

  // (b) Explore como no Gerenciador (grão selecionável, insights ad-level)
  const grao = sp.grao ?? "campanha";
  const groupCol = grao === "anuncio" ? sql`ai.meta_ad_id` : grao === "conjunto" ? sql`ai.meta_adset_id` : sql`ai.meta_campaign_id`;
  const nameJoin =
    grao === "anuncio"
      ? sql`left join meta_ads n on n.company_id = ai.company_id and n.meta_ad_id = ai.meta_ad_id`
      : grao === "conjunto"
        ? sql`left join meta_adsets n on n.company_id = ai.company_id and n.meta_adset_id = ai.meta_adset_id`
        : sql`left join meta_campaigns n on n.company_id = ai.company_id and n.meta_campaign_id = ai.meta_campaign_id`;
  const campFilterAi = sp.campanha ? sql`and ai.meta_campaign_id = ${sp.campanha}` : sql``;
  const contaFilterAi = sp.conta ? sql`and ai.meta_campaign_id in (select mc.meta_campaign_id from meta_campaigns mc where mc.company_id = ${ctx.companyId} and mc.connection_id = ${sp.conta})` : sql``;
  const mgr = await db.execute(sql`
    select ${groupCol} as key, max(n.name) as name, max(n.status) as status,
      coalesce(sum(ai.spend_cents),0)::bigint as spend,
      coalesce(sum(ai.impressions),0)::bigint as impressions,
      coalesce(sum(ai.reach),0)::bigint as reach,
      coalesce(sum(ai.clicks),0)::bigint as clicks,
      coalesce(sum(ai.link_clicks),0)::bigint as link_clicks,
      coalesce(sum(ai.reactions),0)::bigint as reactions,
      coalesce(sum(ai.comments),0)::bigint as comments,
      coalesce(sum(ai.shares),0)::bigint as shares,
      coalesce(sum(ai.saves),0)::bigint as saves,
      coalesce(sum(ai.video_views),0)::bigint as video_views,
      coalesce(sum(ai.post_engagement),0)::bigint as post_engagement,
      coalesce(sum(ai.leads + ai.messages_started),0)::bigint as leads
    from meta_ad_insights_daily ai ${nameJoin}
    where ai.company_id = ${ctx.companyId} and ai.date >= ${since} and ai.date <= ${until} ${campFilterAi} ${contaFilterAi} ${ativos ? sql`and n.status = 'ACTIVE'` : sql``}
    group by key order by spend desc
  `);
  const mgrRows = (mgr.rows as Record<string, unknown>[]).map((r) => {
    const spend = Number(r.spend);
    const impressions = Number(r.impressions);
    const clicks = Number(r.clicks);
    const leads = Number(r.leads);
    return {
      key: String(r.key),
      name: String(r.name ?? r.key),
      status: String(r.status ?? ""),
      spend,
      impressions,
      reach: Number(r.reach),
      clicks,
      linkClicks: Number(r.link_clicks),
      reactions: Number(r.reactions),
      comments: Number(r.comments),
      shares: Number(r.shares),
      saves: Number(r.saves),
      videoViews: Number(r.video_views),
      postEngagement: Number(r.post_engagement),
      leads,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      cpm: impressions ? Math.round((spend / impressions) * 1000) : 0,
      cpl: leads ? Math.round(spend / leads) : 0,
    };
  });

  // comparação opcional (período anterior de mesmo tamanho)
  let prevSpendByKey: Record<string, number> = {};
  if (sp.comparar === "1") {
    const { since: ps, until: pu } = previousPeriod(since, until);
    const prev = await db.execute(sql`
      select ${groupCol} as key, coalesce(sum(ai.spend_cents),0)::bigint as spend
      from meta_ad_insights_daily ai
      where ai.company_id = ${ctx.companyId} and ai.date >= ${ps} and ai.date <= ${pu} ${campFilterAi} ${contaFilterAi}
      group by key
    `);
    prevSpendByKey = Object.fromEntries((prev.rows as Record<string, unknown>[]).map((r) => [String(r.key), Number(r.spend)]));
  }

  const keep = (extra: Record<string, string>) =>
    new URLSearchParams({
      aba: "campanhas",
      ...(sp.periodo ? { periodo: sp.periodo } : {}),
      ...(sp.de ? { de: sp.de } : {}),
      ...(sp.ate ? { ate: sp.ate } : {}),
      ...(sp.conta ? { conta: sp.conta } : {}),
      ...(sp.campanha ? { campanha: sp.campanha } : {}),
      ...(sp.ativos ? { ativos: sp.ativos } : {}),
      ...extra,
    }).toString();
  const graoLink = (g: string) => `/campanhas?${keep({ grao: g, ...(sp.comparar === "1" ? { comparar: "1" } : {}) })}`;
  const compararLink = `/campanhas?${keep({ grao, ...(sp.comparar === "1" ? {} : { comparar: "1" }) })}`;
  const ativosLink = (() => {
    const p = new URLSearchParams(keep({ grao, ...(sp.comparar === "1" ? { comparar: "1" } : {}) }));
    if (ativos) p.delete("ativos");
    else p.set("ativos", "1");
    return `/campanhas?${p.toString()}`;
  })();
  const exportHref = `/campanhas/export?${new URLSearchParams({
    grao,
    periodo: sp.periodo ?? "30",
    ...(sp.de ? { de: sp.de } : {}),
    ...(sp.ate ? { ate: sp.ate } : {}),
    ...(sp.conta ? { conta: sp.conta } : {}),
    ...(sp.campanha ? { campanha: sp.campanha } : {}),
  }).toString()}`;

  return (
    <div className="space-y-8">
      <section className="card overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <h3 className="text-sm font-semibold">Campanhas e resultado real no CRM</h3>
          <Link href={ativosLink} className={cn("rounded-md px-3 py-1 text-sm", ativos ? "bg-brand-500 text-white" : "btn-secondary")}>
            {ativos ? "Mostrando ativos" : "Apenas ativos"}
          </Link>
        </div>
        {crmRows.length === 0 ? (
          <Empty>Nenhuma campanha com dados no período.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Campanha</th>
                <th className="text-right">Investido</th>
                <th className="text-right">Leads Meta</th>
                <th className="text-right">Leads CRM</th>
                <th className="text-right">Agendaram</th>
                <th className="text-right">Compareceram</th>
                <th className="text-right">Fecharam</th>
                <th className="text-right">Vendido</th>
                <th className="text-right">Custo/lead real</th>
                <th className="text-right">ROI</th>
              </tr>
            </thead>
            <tbody>
              {crmRows.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.name}</td>
                  <td className="text-right">{money(c.spend)}</td>
                  <td className="text-right">{nf.format(c.metaLeads)}</td>
                  <td className="text-right">{nf.format(c.crmLeads)}</td>
                  <td className="text-right">{nf.format(c.scheduled)}</td>
                  <td className="text-right">{nf.format(c.attended)}</td>
                  <td className="text-right font-semibold text-green-600">{nf.format(c.won)}</td>
                  <td className="text-right">{money(c.revenue)}</td>
                  <td className="text-right">{c.cplReal ? money(c.cplReal) : "—"}</td>
                  <td className="text-right font-semibold">{c.spend ? `${c.roi.toFixed(1)}x` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <h3 className="text-sm font-semibold">Explore como no Gerenciador de Anúncios</h3>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-lg bg-surface p-1 text-sm">
              {([["campanha", "Campanhas"], ["conjunto", "Conjuntos"], ["anuncio", "Anúncios"]] as const).map(([g, l]) => (
                <Link key={g} href={graoLink(g)} className={cn("rounded-md px-3 py-1", grao === g ? "bg-brand-500 text-white" : "text-muted")}>
                  {l}
                </Link>
              ))}
            </div>
            <Link href={ativosLink} className={cn("rounded-md px-3 py-1 text-sm", ativos ? "bg-brand-500 text-white" : "btn-secondary")}>
              {ativos ? "Mostrando ativos" : "Apenas ativos"}
            </Link>
            <Link href={compararLink} className="btn-secondary text-sm">
              {sp.comparar === "1" ? "Sem comparação" : "Comparar período anterior"}
            </Link>
          </div>
        </div>
        {mgrRows.length === 0 ? (
          <Empty>Sem dados nível anúncio no período. Clique em &quot;Atualizar agora&quot; ou importe o histórico.</Empty>
        ) : (
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{grao === "anuncio" ? "Anúncio" : grao === "conjunto" ? "Conjunto" : "Campanha"}</th>
                <th>Status</th>
                <th className="text-right">Investido</th>
                <th className="text-right">Impressões</th>
                <th className="text-right">Alcance</th>
                <th className="text-right">Cliques</th>
                <th className="text-right">CTR</th>
                <th className="text-right">CPM</th>
                <th className="text-right">Reações</th>
                <th className="text-right">Coment.</th>
                <th className="text-right">Compart.</th>
                <th className="text-right">Salvos</th>
                <th className="text-right">Vídeo</th>
                <th className="text-right">Engaj.</th>
                <th className="text-right">Clique link</th>
                <th className="text-right">Lead Meta</th>
                <th className="text-right">CPL</th>
              </tr>
            </thead>
            <tbody>
              {mgrRows.map((r) => {
                const prev = prevSpendByKey[r.key];
                return (
                  <tr key={r.key}>
                    <td className="font-medium">{r.name}</td>
                    <td className="text-xs text-muted">{r.status}</td>
                    <td className="text-right">
                      {money(r.spend)}
                      {sp.comparar === "1" && prev != null ? (
                        <span className={cn("ml-1 text-xs", r.spend >= prev ? "text-green-600" : "text-red-600")}>
                          {prev ? `${(((r.spend - prev) / prev) * 100).toFixed(0)}%` : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right">{nf.format(r.impressions)}</td>
                    <td className="text-right">{nf.format(r.reach)}</td>
                    <td className="text-right">{nf.format(r.clicks)}</td>
                    <td className="text-right">{r.ctr.toFixed(1)}%</td>
                    <td className="text-right">{money(r.cpm)}</td>
                    <td className="text-right">{nf.format(r.reactions)}</td>
                    <td className="text-right">{nf.format(r.comments)}</td>
                    <td className="text-right">{nf.format(r.shares)}</td>
                    <td className="text-right">{nf.format(r.saves)}</td>
                    <td className="text-right">{nf.format(r.videoViews)}</td>
                    <td className="text-right">{nf.format(r.postEngagement)}</td>
                    <td className="text-right">{nf.format(r.linkClicks)}</td>
                    <td className="text-right">{nf.format(r.leads)}</td>
                    <td className="text-right">{r.cpl ? money(r.cpl) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="p-3">
          <a href={exportHref} className="btn-secondary inline-flex items-center gap-2 text-sm">
            Exportar CSV (Excel)
          </a>
        </div>
      </section>
    </div>
  );
}
