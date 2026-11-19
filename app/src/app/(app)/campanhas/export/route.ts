import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { resolvePeriod, type TrafegoSearch } from "@/lib/trafego";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!can(ctx, "campaigns.view")) return new NextResponse("forbidden", { status: 403 });
  const p = Object.fromEntries(req.nextUrl.searchParams) as TrafegoSearch;
  const { since, until } = resolvePeriod(p);
  const grao = p.grao ?? "campanha";
  const groupCol = grao === "anuncio" ? sql`ai.meta_ad_id` : grao === "conjunto" ? sql`ai.meta_adset_id` : sql`ai.meta_campaign_id`;
  const nameJoin =
    grao === "anuncio"
      ? sql`left join meta_ads n on n.company_id = ai.company_id and n.meta_ad_id = ai.meta_ad_id`
      : grao === "conjunto"
        ? sql`left join meta_adsets n on n.company_id = ai.company_id and n.meta_adset_id = ai.meta_adset_id`
        : sql`left join meta_campaigns n on n.company_id = ai.company_id and n.meta_campaign_id = ai.meta_campaign_id`;
  const campFilter = p.campanha ? sql`and ai.meta_campaign_id = ${p.campanha}` : sql``;
  const r = await db.execute(sql`
    select max(n.name) as nome,
      coalesce(sum(ai.spend_cents),0)/100.0 as investido, coalesce(sum(ai.impressions),0) as impressoes, coalesce(sum(ai.reach),0) as alcance,
      coalesce(sum(ai.clicks),0) as cliques, coalesce(sum(ai.link_clicks),0) as cliques_link,
      coalesce(sum(ai.reactions),0) as reacoes, coalesce(sum(ai.comments),0) as comentarios, coalesce(sum(ai.shares),0) as compartilhamentos, coalesce(sum(ai.saves),0) as salvos,
      coalesce(sum(ai.video_views),0) as video, coalesce(sum(ai.post_engagement),0) as engajamento, coalesce(sum(ai.leads + ai.messages_started),0) as leads
    from meta_ad_insights_daily ai ${nameJoin}
    where ai.company_id = ${ctx.companyId} and ai.date >= ${since} and ai.date <= ${until} ${campFilter}
    group by ${groupCol} order by investido desc
  `);
  const cols = ["nome", "investido", "impressoes", "alcance", "cliques", "cliques_link", "reacoes", "comentarios", "compartilhamentos", "salvos", "video", "engajamento", "leads"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.join(";"), ...(r.rows as Record<string, unknown>[]).map((row) => cols.map((c) => esc(row[c])).join(";"))];
  return new NextResponse("﻿" + lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="trafego-${grao}-${since}_${until}.csv"` },
  });
}
