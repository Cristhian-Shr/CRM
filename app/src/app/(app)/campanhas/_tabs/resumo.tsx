import { sql } from "drizzle-orm";
import { DollarSign, Eye, MousePointerClick, UserPlus } from "lucide-react";
import { StatCard } from "@/components/ui";
import { BarLineChart } from "@/components/charts/bar-line";
import type { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/utils";
import { resolvePeriod, type TrafegoSearch } from "@/lib/trafego";

type Ctx = Awaited<ReturnType<typeof getContext>>;

export async function ResumoTab({ ctx, sp }: { ctx: Ctx; sp: TrafegoSearch }) {
  const { since, until } = resolvePeriod(sp);
  const campFilter = sp.campanha ? sql`and i.meta_campaign_id = ${sp.campanha}` : sql``;
  // Resumo usa insights nível campanha (histórico completo).
  const rows = await db.execute(sql`
    select i.date,
      coalesce(sum(i.spend_cents),0)::bigint as spend,
      coalesce(sum(i.impressions),0)::bigint as impressions,
      coalesce(sum(i.clicks),0)::bigint as clicks,
      coalesce(sum(i.leads + i.messages_started),0)::bigint as leads
    from meta_insights_daily i
    where i.company_id = ${ctx.companyId} and i.date >= ${since} and i.date <= ${until} ${campFilter}
    group by i.date order by i.date
  `);
  const daily = (rows.rows as Record<string, unknown>[]).map((r) => ({
    date: String(r.date),
    spend: Number(r.spend),
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    leads: Number(r.leads),
  }));
  const tot = daily.reduce(
    (s, d) => ({ spend: s.spend + d.spend, impressions: s.impressions + d.impressions, clicks: s.clicks + d.clicks, leads: s.leads + d.leads }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0 },
  );
  const nf = new Intl.NumberFormat("pt-BR");
  const ctrPct = tot.impressions ? ((tot.clicks / tot.impressions) * 100).toFixed(1) : "0.0";
  const cpm = tot.impressions ? Math.round((tot.spend / tot.impressions) * 1000) : 0;
  const chart = daily.map((d) => ({ label: d.date.slice(8, 10) + "/" + d.date.slice(5, 7), bar: d.spend / 100, line: d.leads }));

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Investido" value={money(tot.spend)} icon={DollarSign} />
        <StatCard label="Leads (Meta)" value={nf.format(tot.leads)} icon={UserPlus} />
        <StatCard label="Custo por lead" value={tot.leads ? money(Math.round(tot.spend / tot.leads)) : "—"} icon={DollarSign} />
        <StatCard label="CTR" value={`${ctrPct}%`} hint={`${nf.format(tot.clicks)} cliques`} icon={MousePointerClick} />
        <StatCard label="CPM" value={money(cpm)} hint={`${nf.format(tot.impressions)} impressões`} icon={Eye} />
      </div>
      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">Investido × leads por dia</h3>
        <BarLineChart data={chart} barLabel="Investido" lineLabel="Leads (Meta)" />
      </div>
    </>
  );
}
