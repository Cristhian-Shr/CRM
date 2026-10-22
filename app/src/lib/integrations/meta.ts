import "server-only";
import { eq, sql } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";

const GRAPH = "https://graph.facebook.com/v21.0";

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Meta respondeu ${res.status}`);
  return json;
}

type Paged<T> = { data: T[]; paging?: { next?: string } };
type Campaign = {
  id: string;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
};
type Insight = {
  campaign_id: string;
  campaign_name?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
};

const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
const MSG_ACTIONS = ["onsite_conversion.messaging_conversation_started_7d"];

function sumActions(actions: Insight["actions"], types: string[]) {
  return Math.round(
    (actions ?? [])
      .filter((a) => types.includes(a.action_type))
      .reduce((s, a) => Math.max(s, Number(a.value)), 0), // tipos se sobrepõem; usa o maior
  );
}

/** Sincroniza campanhas e números diários (últimos 7 dias) de uma conexão. */
export async function syncMetaConnection(conn: typeof schema.metaConnections.$inferSelect) {
  try {
    const token = decrypt(conn.accessTokenEnc);
    let next: string | null = `${conn.adAccountId}/campaigns`;
    const campaigns: Campaign[] = [];
    let params: Record<string, string> = {
      fields: "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time",
      limit: "200",
    };
    while (next) {
      const page: Paged<Campaign> = await graph<Paged<Campaign>>(next, token, params);
      campaigns.push(...page.data);
      next = page.paging?.next ? page.paging.next.replace(`${GRAPH}/`, "").split("?")[0] : null;
      if (page.paging?.next) params = Object.fromEntries(new URL(page.paging.next).searchParams);
      delete params.access_token;
    }
    for (const c of campaigns) {
      await db
        .insert(schema.metaCampaigns)
        .values({
          companyId: conn.companyId,
          connectionId: conn.id,
          metaCampaignId: c.id,
          name: c.name,
          objective: c.objective,
          status: c.status,
          dailyBudgetCents: c.daily_budget ? Number(c.daily_budget) : null,
          lifetimeBudgetCents: c.lifetime_budget ? Number(c.lifetime_budget) : null,
          startTime: c.start_time ? new Date(c.start_time) : null,
          stopTime: c.stop_time ? new Date(c.stop_time) : null,
        })
        .onConflictDoUpdate({
          target: [schema.metaCampaigns.companyId, schema.metaCampaigns.metaCampaignId],
          set: {
            name: sql`excluded.name`,
            status: sql`excluded.status`,
            objective: sql`excluded.objective`,
            dailyBudgetCents: sql`excluded.daily_budget_cents`,
            lifetimeBudgetCents: sql`excluded.lifetime_budget_cents`,
            stopTime: sql`excluded.stop_time`,
            updatedAt: new Date(),
          },
        });
    }

    const insights = await graph<Paged<Insight>>(`${conn.adAccountId}/insights`, token, {
      level: "campaign",
      time_increment: "1",
      date_preset: "last_7d",
      fields: "campaign_id,spend,impressions,reach,clicks,actions",
      limit: "500",
    });
    for (const i of insights.data) {
      await db
        .insert(schema.metaInsightsDaily)
        .values({
          companyId: conn.companyId,
          metaCampaignId: i.campaign_id,
          date: i.date_start,
          spendCents: Math.round(Number(i.spend ?? 0) * 100),
          impressions: Number(i.impressions ?? 0),
          reach: Number(i.reach ?? 0),
          clicks: Number(i.clicks ?? 0),
          leads: sumActions(i.actions, LEAD_ACTIONS),
          messagesStarted: sumActions(i.actions, MSG_ACTIONS),
        })
        .onConflictDoUpdate({
          target: [schema.metaInsightsDaily.companyId, schema.metaInsightsDaily.metaCampaignId, schema.metaInsightsDaily.date],
          set: {
            spendCents: sql`excluded.spend_cents`,
            impressions: sql`excluded.impressions`,
            reach: sql`excluded.reach`,
            clicks: sql`excluded.clicks`,
            leads: sql`excluded.leads`,
            messagesStarted: sql`excluded.messages_started`,
          },
        });
    }
    await db
      .update(schema.metaConnections)
      .set({ lastSyncAt: new Date(), lastError: null, status: "connected" })
      .where(eq(schema.metaConnections.id, conn.id));
    return { campaigns: campaigns.length, insights: insights.data.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(schema.metaConnections).set({ lastError: msg, status: "error" }).where(eq(schema.metaConnections.id, conn.id));
    throw e;
  }
}

/**
 * Puxa os insights diários de UM mês (time_range) de uma conexão e grava em
 * meta_insights_daily. Cria um registro mínimo de campanha para campanhas antigas
 * que não estão mais na lista ativa. Retorna quantas linhas foram processadas.
 */
export async function backfillMetaMonth(conn: typeof schema.metaConnections.$inferSelect, year: number, month: number) {
  const token = decrypt(conn.accessTokenEnc);
  const since = `${year}-${String(month).padStart(2, "0")}-01`;
  const until = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); // último dia do mês
  let next: string | null = `${conn.adAccountId}/insights`;
  let params: Record<string, string> = {
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,actions",
    limit: "500",
  };
  let rows = 0;
  while (next) {
    const page: Paged<Insight> = await graph<Paged<Insight>>(next, token, params);
    for (const i of page.data) {
      await db
        .insert(schema.metaCampaigns)
        .values({
          companyId: conn.companyId,
          connectionId: conn.id,
          metaCampaignId: i.campaign_id,
          name: i.campaign_name ?? i.campaign_id,
          status: "ARCHIVED",
        })
        .onConflictDoNothing({ target: [schema.metaCampaigns.companyId, schema.metaCampaigns.metaCampaignId] });
      await db
        .insert(schema.metaInsightsDaily)
        .values({
          companyId: conn.companyId,
          metaCampaignId: i.campaign_id,
          date: i.date_start,
          spendCents: Math.round(Number(i.spend ?? 0) * 100),
          impressions: Number(i.impressions ?? 0),
          reach: Number(i.reach ?? 0),
          clicks: Number(i.clicks ?? 0),
          leads: sumActions(i.actions, LEAD_ACTIONS),
          messagesStarted: sumActions(i.actions, MSG_ACTIONS),
        })
        .onConflictDoUpdate({
          target: [schema.metaInsightsDaily.companyId, schema.metaInsightsDaily.metaCampaignId, schema.metaInsightsDaily.date],
          set: {
            spendCents: sql`excluded.spend_cents`,
            impressions: sql`excluded.impressions`,
            reach: sql`excluded.reach`,
            clicks: sql`excluded.clicks`,
            leads: sql`excluded.leads`,
            messagesStarted: sql`excluded.messages_started`,
          },
        });
      rows++;
    }
    next = page.paging?.next ? page.paging.next.replace(`${GRAPH}/`, "").split("?")[0] : null;
    if (page.paging?.next) {
      params = Object.fromEntries(new URL(page.paging.next).searchParams);
      delete params.access_token;
    }
  }
  return { rows };
}

/** Busca os dados de um lead de formulário (Lead Ads). */
export async function fetchLead(leadgenId: string, token: string) {
  return graph<{
    id: string;
    created_time: string;
    ad_id?: string;
    adset_id?: string;
    campaign_id?: string;
    field_data: { name: string; values: string[] }[];
  }>(leadgenId, token, { fields: "id,created_time,ad_id,adset_id,campaign_id,field_data" });
}
