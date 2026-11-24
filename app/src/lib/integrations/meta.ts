import "server-only";
import { eq, sql } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { mapEngagement, maxAction, LEAD_ACTIONS, MSG_ACTIONS } from "./meta-metrics";
import { sendText } from "./whatsapp";

const GRAPH = "https://graph.facebook.com/v21.0";

const GRAPH_MAX_RETRIES = 3; // até 4 tentativas no total
// Códigos da Meta considerados transitórios (temporários / rate-limit).
const GRAPH_RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);

type MetaError = { message?: string; code?: number; error_subcode?: number; is_transient?: boolean; type?: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRetryableGraphError(status: number, err?: MetaError): boolean {
  if (status >= 500 || status === 429) return true;
  if (!err) return false;
  if (err.is_transient) return true;
  if (err.code != null && GRAPH_RETRYABLE_CODES.has(err.code)) return true;
  // O endpoint de insights às vezes devolve "(#100) nonexisting field" de forma
  // transitória para campos que de fato existem (job assíncrono ainda não pronto,
  // carga). Tratamos #100 como reententável: se o campo for mesmo inválido, apenas
  // falha alguns segundos depois, sem ficar preso como erro permanente.
  if (err.code === 100) return true;
  return false;
}

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= GRAPH_MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 0.5s, 1s, 2s

    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (e) {
      // Falha de rede: reententável enquanto houver tentativas.
      lastErr = e instanceof Error ? e : new Error(String(e));
      continue;
    }

    const json = (await res.json().catch(() => ({}))) as T & { error?: MetaError };
    if (res.ok && !json.error) return json;

    lastErr = new Error(json.error?.message ?? `Meta respondeu ${res.status}`);
    if (!isRetryableGraphError(res.status, json.error)) throw lastErr;
  }
  throw lastErr ?? new Error("Meta: falha após múltiplas tentativas");
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
    // Detecção de funding é best-effort: o enum numérico `funding_source_details.type`
    // da Meta não é documentado, então usamos o texto do display como sinal principal e só
    // usamos `type` para PROMOVER a pré-pago quando o texto é ambíguo — nunca para sobrescrever
    // uma correspondência de texto clara.
    const fundingStr = (acct.funding_source_details?.display_string ?? "").toLowerCase();
    const prepaidByText = /pré|pre-?pag|prepaid|boleto|pix|wallet|saldo/i.test(fundingStr);
    let fundingType = prepaidByText ? "prepaid" : "postpaid";
    // Heurística best-effort: se o texto não deixou claro que é pré-pago mas a conta expõe um
    // `type` estruturado (enum não documentado) e um `balance` positivo típico de pré-pago,
    // promovemos para pré-pago.
    if (!prepaidByText && acct.funding_source_details?.type != null && acct.balance != null && Number(acct.balance) > 0) {
      fundingType = "prepaid";
    }
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
    type AdsetRow = { id: string; name: string; status?: string; campaign_id: string; daily_budget?: string; lifetime_budget?: string };
    let adsetNext: string | null = `${conn.adAccountId}/adsets`;
    let adsetParams: Record<string, string> = { fields: "id,name,status,campaign_id,daily_budget,lifetime_budget", limit: "500" };
    while (adsetNext) {
      const page: Paged<AdsetRow> = await graph<Paged<AdsetRow>>(adsetNext, token, adsetParams);
      for (const a of page.data) {
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
      adsetNext = page.paging?.next ? page.paging.next.replace(`${GRAPH}/`, "").split("?")[0] : null;
      if (page.paging?.next) { adsetParams = Object.fromEntries(new URL(page.paging.next).searchParams); delete adsetParams.access_token; }
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
    let adNext: string | null = `${conn.adAccountId}/ads`;
    let adParams: Record<string, string> = {
      // thumbnail_width/height(600) força a Meta a devolver a prévia em 600×600
      // (o padrão é ~64px, que fica borrado ao exibir). Vale p/ imagem e vídeo.
      fields: "id,name,status,adset_id,campaign_id,creative.thumbnail_width(600).thumbnail_height(600){id,thumbnail_url,title,body,effective_instagram_media_id,effective_object_story_id}",
      limit: "500",
    };
    while (adNext) {
      const page: Paged<AdRow> = await graph<Paged<AdRow>>(adNext, token, adParams);
      for (const a of page.data) {
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
      adNext = page.paging?.next ? page.paging.next.replace(`${GRAPH}/`, "").split("?")[0] : null;
      if (page.paging?.next) { adParams = Object.fromEntries(new URL(page.paging.next).searchParams); delete adParams.access_token; }
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
    type AdInsightRow = { ad_id: string; adset_id: string; campaign_id: string; date_start: string; spend?: string; impressions?: string; reach?: string; clicks?: string; inline_link_clicks?: string; actions?: { action_type: string; value: string }[] };
    let adInsightNext: string | null = `${conn.adAccountId}/insights`;
    let adInsightParams: Record<string, string> = { level: "ad", time_increment: "1", date_preset: "last_30d", fields: "ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,inline_link_clicks,actions", limit: "500" };
    // Dados nível-anúncio são secundários (abastecem a aba Criativos). O endpoint de
    // insights do Meta às vezes devolve "(#100) nonexisting field" transitório na
    // paginação — o retry no graph() cobre a maioria; se ainda assim falhar, apenas
    // logamos e seguimos: o sync principal não deve quebrar nem travar erro na tela.
    try {
    while (adInsightNext) {
      const page: Paged<AdInsightRow> = await graph<Paged<AdInsightRow>>(adInsightNext, token, adInsightParams);
      for (const i of page.data) {
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
      adInsightNext = page.paging?.next ? page.paging.next.replace(`${GRAPH}/`, "").split("?")[0] : null;
      if (page.paging?.next) { adInsightParams = Object.fromEntries(new URL(page.paging.next).searchParams); delete adInsightParams.access_token; }
    }
    } catch (e) {
      console.warn(`[meta] insights nível-anúncio falharam p/ conexão ${conn.id}; sync principal segue.`, e instanceof Error ? e.message : e);
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
  // ── Nível campanha (alimenta Resumo/Campanhas) ──
  // Coletamos TODAS as páginas na memória e gravamos em lote. Antes era 1 INSERT
  // por linha (centenas de round-trips ao banco), o que estourava o tempo da função
  // serverless e deixava o mês importado pela metade.
  let next: string | null = `${conn.adAccountId}/insights`;
  let params: Record<string, string> = {
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,actions",
    limit: "500",
  };
  const campaignNames = new Map<string, string>();
  const dailyRows: (typeof schema.metaInsightsDaily.$inferInsert)[] = [];
  while (next) {
    const page: Paged<Insight> = await graph<Paged<Insight>>(next, token, params);
    for (const i of page.data) {
      campaignNames.set(i.campaign_id, i.campaign_name ?? i.campaign_id);
      dailyRows.push({
        companyId: conn.companyId,
        metaCampaignId: i.campaign_id,
        date: i.date_start,
        spendCents: Math.round(Number(i.spend ?? 0) * 100),
        impressions: Number(i.impressions ?? 0),
        reach: Number(i.reach ?? 0),
        clicks: Number(i.clicks ?? 0),
        leads: maxAction(i.actions, LEAD_ACTIONS),
        messagesStarted: maxAction(i.actions, MSG_ACTIONS),
      });
    }
    next = page.paging?.next ? page.paging.next.replace(`${GRAPH}/`, "").split("?")[0] : null;
    if (page.paging?.next) {
      params = Object.fromEntries(new URL(page.paging.next).searchParams);
      delete params.access_token;
    }
  }

  if (campaignNames.size) {
    await db
      .insert(schema.metaCampaigns)
      .values([...campaignNames].map(([id, name]) => ({ companyId: conn.companyId, connectionId: conn.id, metaCampaignId: id, name, status: "ARCHIVED" })))
      .onConflictDoNothing({ target: [schema.metaCampaigns.companyId, schema.metaCampaigns.metaCampaignId] });
  }
  for (const batch of chunk(dailyRows, 500)) {
    await db
      .insert(schema.metaInsightsDaily)
      .values(batch)
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
  const rows = dailyRows.length;

  // ── Nível anúncio (alimenta Criativos) — secundário e tolerante a falha ──
  try {
    let adNext: string | null = `${conn.adAccountId}/insights`;
    let adParams: Record<string, string> = {
      level: "ad", time_increment: "1", time_range: JSON.stringify({ since, until }),
      fields: "ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,inline_link_clicks,actions", limit: "500",
    };
    const adRows: (typeof schema.metaAdInsightsDaily.$inferInsert)[] = [];
    while (adNext) {
      const page: Paged<{ ad_id: string; adset_id: string; campaign_id: string; date_start: string; spend?: string; impressions?: string; reach?: string; clicks?: string; inline_link_clicks?: string; actions?: { action_type: string; value: string }[] }> = await graph(adNext, token, adParams);
      for (const i of page.data) {
        const eng = mapEngagement(i.actions);
        adRows.push({
          companyId: conn.companyId, metaAdId: i.ad_id, metaAdsetId: i.adset_id, metaCampaignId: i.campaign_id, date: i.date_start,
          spendCents: Math.round(Number(i.spend ?? 0) * 100), impressions: Number(i.impressions ?? 0), reach: Number(i.reach ?? 0), clicks: Number(i.clicks ?? 0), linkClicks: Number(i.inline_link_clicks ?? eng.linkClicks),
          leads: eng.leads, messagesStarted: eng.messagesStarted, reactions: eng.reactions, comments: eng.comments, shares: eng.shares, saves: eng.saves, videoViews: eng.videoViews, postEngagement: eng.postEngagement,
        });
      }
      adNext = page.paging?.next ? page.paging.next.replace(`${GRAPH}/`, "").split("?")[0] : null;
      if (page.paging?.next) { adParams = Object.fromEntries(new URL(page.paging.next).searchParams); delete adParams.access_token; }
    }
    for (const batch of chunk(adRows, 300)) {
      await db.insert(schema.metaAdInsightsDaily).values(batch).onConflictDoUpdate({
        target: [schema.metaAdInsightsDaily.companyId, schema.metaAdInsightsDaily.metaAdId, schema.metaAdInsightsDaily.date],
        set: { spendCents: sql`excluded.spend_cents`, impressions: sql`excluded.impressions`, reach: sql`excluded.reach`, clicks: sql`excluded.clicks`, linkClicks: sql`excluded.link_clicks`, leads: sql`excluded.leads`, messagesStarted: sql`excluded.messages_started`, reactions: sql`excluded.reactions`, comments: sql`excluded.comments`, shares: sql`excluded.shares`, saves: sql`excluded.saves`, videoViews: sql`excluded.video_views`, postEngagement: sql`excluded.post_engagement` },
      });
    }
  } catch (e) {
    console.warn(`[meta] backfill nível-anúncio falhou p/ ${since}; nível campanha já gravado.`, e instanceof Error ? e.message : e);
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
