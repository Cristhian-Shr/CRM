import "server-only";
import { eq, sql } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { mapEngagement, maxAction, LEAD_ACTIONS, MSG_ACTIONS } from "./meta-metrics";
import { sendText } from "./whatsapp";

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

/** Sincroniza campanhas e números diários (últimos 7 dias) de uma conexão. */
export async function syncMetaConnection(conn: typeof schema.metaConnections.$inferSelect) {
  try {
    const token = decrypt(conn.accessTokenEnc);

    // ── Info da conta (nome, moeda, saldo, funding) ──
    type AcctInfo = {
      name?: string;
      currency?: string;
      account_status?: number;
      balance?: string;
      spend_cap?: string;
      funding_source_details?: { type?: number; display_string?: string };
    };
    const acct = await graph<AcctInfo>(conn.adAccountId, token, {
      fields: "name,currency,account_status,balance,spend_cap,funding_source_details",
    });
    // Meta não expõe o tipo de forma 100% estável; tratamos como pré-pago quando o display
    // menciona boleto/pix/prepaid ou quando há `balance` positivo com funding de carteira.
    const fundingStr = (acct.funding_source_details?.display_string ?? "").toLowerCase();
    const fundingType = /pré|pre-?pag|prepaid|boleto|pix|wallet|saldo/.test(fundingStr) ? "prepaid" : "postpaid";
    let pageName: string | null = null;
    if (conn.pageId) {
      try {
        const pg = await graph<{ name?: string }>(conn.pageId, token, { fields: "name" });
        pageName = pg.name ?? null;
      } catch {
        pageName = null;
      }
    }

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

    // ── Conjuntos ──
    const adsets = await graph<Paged<{ id: string; name: string; status?: string; campaign_id: string; daily_budget?: string; lifetime_budget?: string }>>(
      `${conn.adAccountId}/adsets`,
      token,
      { fields: "id,name,status,campaign_id,daily_budget,lifetime_budget", limit: "500" },
    );
    for (const a of adsets.data) {
      await db
        .insert(schema.metaAdsets)
        .values({
          companyId: conn.companyId,
          connectionId: conn.id,
          metaAdsetId: a.id,
          metaCampaignId: a.campaign_id,
          name: a.name,
          status: a.status,
          dailyBudgetCents: a.daily_budget ? Number(a.daily_budget) : null,
          lifetimeBudgetCents: a.lifetime_budget ? Number(a.lifetime_budget) : null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.metaAdsets.companyId, schema.metaAdsets.metaAdsetId],
          set: { name: sql`excluded.name`, status: sql`excluded.status`, dailyBudgetCents: sql`excluded.daily_budget_cents`, lifetimeBudgetCents: sql`excluded.lifetime_budget_cents`, updatedAt: new Date() },
        });
    }

    // ── Anúncios + criativo (thumbnail) ──
    type AdRow = {
      id: string;
      name: string;
      status?: string;
      adset_id: string;
      campaign_id: string;
      creative?: { id?: string; thumbnail_url?: string; title?: string; body?: string; effective_instagram_media_id?: string; effective_object_story_id?: string };
    };
    const ads = await graph<Paged<AdRow>>(`${conn.adAccountId}/ads`, token, {
      fields: "id,name,status,adset_id,campaign_id,creative{id,thumbnail_url,title,body,effective_instagram_media_id,effective_object_story_id}",
      limit: "500",
    });
    for (const a of ads.data) {
      const channel = a.creative?.effective_instagram_media_id ? "Instagram" : pageName ?? "Facebook";
      await db
        .insert(schema.metaAds)
        .values({
          companyId: conn.companyId,
          connectionId: conn.id,
          metaAdId: a.id,
          metaAdsetId: a.adset_id,
          metaCampaignId: a.campaign_id,
          name: a.name,
          status: a.status,
          creativeId: a.creative?.id ?? null,
          thumbnailUrl: a.creative?.thumbnail_url ?? null,
          title: a.creative?.title ?? null,
          body: a.creative?.body ?? null,
          channel,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.metaAds.companyId, schema.metaAds.metaAdId],
          set: { name: sql`excluded.name`, status: sql`excluded.status`, thumbnailUrl: sql`excluded.thumbnail_url`, title: sql`excluded.title`, body: sql`excluded.body`, channel: sql`excluded.channel`, updatedAt: new Date() },
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
          leads: maxAction(i.actions, LEAD_ACTIONS),
          messagesStarted: maxAction(i.actions, MSG_ACTIONS),
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

    // ── Insights nível anúncio (últimos 30 dias) ──
    const adInsights = await graph<Paged<{ ad_id: string; adset_id: string; campaign_id: string; date_start: string; spend?: string; impressions?: string; reach?: string; clicks?: string; inline_link_clicks?: string; actions?: { action_type: string; value: string }[] }>>(
      `${conn.adAccountId}/insights`,
      token,
      { level: "ad", time_increment: "1", date_preset: "last_30d", fields: "ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,inline_link_clicks,actions", limit: "500" },
    );
    for (const i of adInsights.data) {
      const eng = mapEngagement(i.actions);
      await db
        .insert(schema.metaAdInsightsDaily)
        .values({
          companyId: conn.companyId,
          metaAdId: i.ad_id,
          metaAdsetId: i.adset_id,
          metaCampaignId: i.campaign_id,
          date: i.date_start,
          spendCents: Math.round(Number(i.spend ?? 0) * 100),
          impressions: Number(i.impressions ?? 0),
          reach: Number(i.reach ?? 0),
          clicks: Number(i.clicks ?? 0),
          linkClicks: Number(i.inline_link_clicks ?? eng.linkClicks),
          leads: eng.leads,
          messagesStarted: eng.messagesStarted,
          reactions: eng.reactions,
          comments: eng.comments,
          shares: eng.shares,
          saves: eng.saves,
          videoViews: eng.videoViews,
          postEngagement: eng.postEngagement,
        })
        .onConflictDoUpdate({
          target: [schema.metaAdInsightsDaily.companyId, schema.metaAdInsightsDaily.metaAdId, schema.metaAdInsightsDaily.date],
          set: {
            spendCents: sql`excluded.spend_cents`, impressions: sql`excluded.impressions`, reach: sql`excluded.reach`, clicks: sql`excluded.clicks`, linkClicks: sql`excluded.link_clicks`,
            leads: sql`excluded.leads`, messagesStarted: sql`excluded.messages_started`, reactions: sql`excluded.reactions`, comments: sql`excluded.comments`, shares: sql`excluded.shares`, saves: sql`excluded.saves`, videoViews: sql`excluded.video_views`, postEngagement: sql`excluded.post_engagement`,
          },
        });
    }

    await db
      .update(schema.metaConnections)
      .set({
        lastSyncAt: new Date(),
        lastError: null,
        status: "connected",
        accountName: acct.name ?? null,
        currency: acct.currency ?? "BRL",
        accountStatus: acct.account_status != null ? String(acct.account_status) : null,
        fundingType,
        balanceCents: acct.balance != null ? Math.round(Number(acct.balance)) : null,
        spendCapCents: acct.spend_cap != null ? Math.round(Number(acct.spend_cap)) : null,
        pageName,
      })
      .where(eq(schema.metaConnections.id, conn.id));

    const fresh = await db.query.metaConnections.findFirst({ where: eq(schema.metaConnections.id, conn.id) });
    if (fresh) await maybeAlertLowBalance(fresh);
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
          leads: maxAction(i.actions, LEAD_ACTIONS),
          messagesStarted: maxAction(i.actions, MSG_ACTIONS),
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

  // ad-level no mesmo mês
  let adNext: string | null = `${conn.adAccountId}/insights`;
  let adParams: Record<string, string> = {
    level: "ad", time_increment: "1", time_range: JSON.stringify({ since, until }),
    fields: "ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,inline_link_clicks,actions", limit: "500",
  };
  while (adNext) {
    const page: Paged<{ ad_id: string; adset_id: string; campaign_id: string; date_start: string; spend?: string; impressions?: string; reach?: string; clicks?: string; inline_link_clicks?: string; actions?: { action_type: string; value: string }[] }> = await graph(adNext, token, adParams);
    for (const i of page.data) {
      const eng = mapEngagement(i.actions);
      await db.insert(schema.metaAdInsightsDaily).values({
        companyId: conn.companyId, metaAdId: i.ad_id, metaAdsetId: i.adset_id, metaCampaignId: i.campaign_id, date: i.date_start,
        spendCents: Math.round(Number(i.spend ?? 0) * 100), impressions: Number(i.impressions ?? 0), reach: Number(i.reach ?? 0), clicks: Number(i.clicks ?? 0), linkClicks: Number(i.inline_link_clicks ?? eng.linkClicks),
        leads: eng.leads, messagesStarted: eng.messagesStarted, reactions: eng.reactions, comments: eng.comments, shares: eng.shares, saves: eng.saves, videoViews: eng.videoViews, postEngagement: eng.postEngagement,
      }).onConflictDoUpdate({
        target: [schema.metaAdInsightsDaily.companyId, schema.metaAdInsightsDaily.metaAdId, schema.metaAdInsightsDaily.date],
        set: { spendCents: sql`excluded.spend_cents`, impressions: sql`excluded.impressions`, reach: sql`excluded.reach`, clicks: sql`excluded.clicks`, linkClicks: sql`excluded.link_clicks`, leads: sql`excluded.leads`, messagesStarted: sql`excluded.messages_started`, reactions: sql`excluded.reactions`, comments: sql`excluded.comments`, shares: sql`excluded.shares`, saves: sql`excluded.saves`, videoViews: sql`excluded.video_views`, postEngagement: sql`excluded.post_engagement` },
      });
    }
    adNext = page.paging?.next ? page.paging.next.replace(`${GRAPH}/`, "").split("?")[0] : null;
    if (page.paging?.next) { adParams = Object.fromEntries(new URL(page.paging.next).searchParams); delete adParams.access_token; }
  }

  return { rows };
}

const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/** Envia WhatsApp se a conta pré-paga estiver abaixo do limite configurado (com cooldown). */
export async function maybeAlertLowBalance(conn: typeof schema.metaConnections.$inferSelect) {
  if (conn.fundingType !== "prepaid" || !conn.alertEnabled || !conn.alertPhone) return;
  if (conn.lowBalanceAlertCents == null || conn.balanceCents == null) return;
  if (conn.balanceCents >= conn.lowBalanceAlertCents) return;
  if (conn.lastBalanceAlertAt && Date.now() - conn.lastBalanceAlertAt.getTime() < ALERT_COOLDOWN_MS) return;

  const wa = await db.query.whatsappAccounts.findFirst({ where: eq(schema.whatsappAccounts.companyId, conn.companyId) });
  if (!wa || wa.status !== "connected" || !wa.phoneNumberId || !wa.accessTokenEnc) return;
  const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: conn.currency ?? "BRL" });
  const body = `⚠️ Saldo baixo na conta de anúncios ${conn.accountName ?? conn.adAccountId}: ${money(conn.balanceCents)} (limite ${money(conn.lowBalanceAlertCents)}). Recarregue para os anúncios não pausarem.`;
  try {
    await sendText(wa.phoneNumberId, decrypt(wa.accessTokenEnc), conn.alertPhone, body);
    await db.update(schema.metaConnections).set({ lastBalanceAlertAt: new Date() }).where(eq(schema.metaConnections.id, conn.id));
  } catch {
    // não falha o sync por erro de WhatsApp
  }
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
