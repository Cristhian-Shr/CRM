import { sql } from "drizzle-orm";
import Link from "next/link";
import { Empty } from "@/components/ui";
import type { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { cn, money } from "@/lib/utils";
import { resolvePeriod, type TrafegoSearch } from "@/lib/trafego";

type Ctx = Awaited<ReturnType<typeof getContext>>;
const nf = new Intl.NumberFormat("pt-BR");

export async function CriativosTab({ ctx, sp }: { ctx: Ctx; sp: TrafegoSearch }) {
  const { since, until } = resolvePeriod(sp);
  const campFilter = sp.campanha ? sql`and ai.meta_campaign_id = ${sp.campanha}` : sql``;
  const contaFilter = sp.conta ? sql`and a.connection_id = ${sp.conta}` : sql``;
  const order = sp.ordenar ?? "investido";
  const orderSql =
    order === "leads"
      ? sql`leads desc`
      : order === "ctr"
        ? sql`ctr desc`
        : order === "cpl"
          ? sql`(case when leads>0 then spend/leads else 999999999 end) asc`
          : sql`spend desc`;
  const r = await db.execute(sql`
    select a.meta_ad_id, a.name, a.thumbnail_url, a.status, a.channel, cmp.name as campaign_name,
      coalesce(sum(ai.spend_cents),0)::bigint as spend, coalesce(sum(ai.impressions),0)::bigint as impressions,
      coalesce(sum(ai.clicks),0)::bigint as clicks, coalesce(sum(ai.leads + ai.messages_started),0)::bigint as leads,
      case when coalesce(sum(ai.impressions),0)>0 then (sum(ai.clicks)::float/sum(ai.impressions)) else 0 end as ctr
    from meta_ads a
    join meta_ad_insights_daily ai on ai.company_id = a.company_id and ai.meta_ad_id = a.meta_ad_id and ai.date >= ${since} and ai.date <= ${until}
    left join meta_campaigns cmp on cmp.company_id = a.company_id and cmp.meta_campaign_id = a.meta_campaign_id
    where a.company_id = ${ctx.companyId} ${campFilter} ${contaFilter}
    group by a.meta_ad_id, a.name, a.thumbnail_url, a.status, a.channel, cmp.name
    having coalesce(sum(ai.spend_cents),0) > 0
    order by ${orderSql}
  `);
  const ads = (r.rows as Record<string, unknown>[]).map((x) => {
    const spend = Number(x.spend);
    const impressions = Number(x.impressions);
    const leads = Number(x.leads);
    return {
      id: String(x.meta_ad_id),
      name: String(x.name),
      thumb: x.thumbnail_url ? String(x.thumbnail_url) : null,
      status: String(x.status ?? ""),
      channel: String(x.channel ?? ""),
      campaign: String(x.campaign_name ?? ""),
      spend,
      impressions,
      clicks: Number(x.clicks),
      leads,
      ctr: impressions ? (Number(x.clicks) / impressions) * 100 : 0,
      cpl: leads ? Math.round(spend / leads) : 0,
    };
  });
  const ordLink = (o: string) =>
    `/campanhas?${new URLSearchParams({
      aba: "criativos",
      ordenar: o,
      ...(sp.periodo ? { periodo: sp.periodo } : {}),
      ...(sp.de ? { de: sp.de } : {}),
      ...(sp.ate ? { ate: sp.ate } : {}),
      ...(sp.conta ? { conta: sp.conta } : {}),
      ...(sp.campanha ? { campanha: sp.campanha } : {}),
    }).toString()}`;

  if (!ads.length) return <Empty>Nenhum anúncio com investimento no período. Clique em &quot;Atualizar agora&quot;.</Empty>;

  return (
    <>
      <div className="mb-4 flex items-center gap-2 text-sm">
        <span className="text-muted">Ordenar por:</span>
        {[
          ["investido", "Investido"],
          ["leads", "Leads"],
          ["cpl", "CPL"],
          ["ctr", "CTR"],
        ].map(([o, l]) => (
          <Link key={o} href={ordLink(o)} className={cn("rounded-md px-2 py-1", order === o ? "bg-brand-500 text-white" : "text-muted")}>
            {l}
          </Link>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ads.map((a) => (
          <div key={a.id} className="card overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {a.thumb ? (
              <img src={a.thumb} alt={a.name} className="h-32 w-full bg-surface object-contain" />
            ) : (
              <div className="flex h-32 items-center justify-center bg-surface text-xs text-muted">sem prévia</div>
            )}
            <div className="space-y-1 p-3">
              <div className="truncate text-sm font-medium" title={a.name}>
                {a.name}
              </div>
              <div className="truncate text-xs text-muted">
                {a.campaign} · {a.channel} · {a.status}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-muted">Investido</span>
                <span className="text-right font-medium">{money(a.spend)}</span>
                <span className="text-muted">Leads</span>
                <span className="text-right font-medium">{a.leads}</span>
                <span className="text-muted">CPL</span>
                <span className="text-right">{a.cpl ? money(a.cpl) : "—"}</span>
                <span className="text-muted">CTR</span>
                <span className="text-right">{a.ctr.toFixed(1)}%</span>
                <span className="text-muted">Impressões</span>
                <span className="text-right">{nf.format(a.impressions)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
