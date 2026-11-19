# Tráfego Pago (Meta Ads) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a tela `/campanhas` num painel "Tráfego pago" que cruza Meta Ads (campanhas, conjuntos, anúncios, criativos, engajamento, saldo) com leads/agendamentos/vendas do CRM, com abas Resumo, Campanhas, Anúncios e criativos, WhatsApp, Vínculos e Alerta de saldo.

**Architecture:** Expande a coleta da Meta para o grão de anúncio (`meta_ad_insights_daily`) e faz rollup por SUM para conjunto/campanha; mantém `meta_insights_daily` (campanha) para Resumo/histórico. UI é server-rendered por aba via `?aba=`, com filtros client que empurram searchParams (padrão de `/relatorios`). Alerta de saldo roda dentro do sync (sem cron, pois o Hobby não tem crons).

**Tech Stack:** Next.js (App Router, server components), Drizzle ORM + Postgres (Neon), Tailwind, Meta Graph API v21, WhatsApp Cloud API. Sem framework de teste — verificação por `npm run typecheck`, `npm run lint`, `npm run build` e migrations Drizzle.

**Spec:** `docs/superpowers/specs/2026-11-18-trafego-pago-meta-design.md`

**Convenções de verificação** (rodar sempre de dentro de `app/`):
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Gerar migration: `npm run db:generate`
- Aplicar migration: carregar env e `npm run db:migrate` (ver Task 2 para o detalhe do `.env.local`)

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `app/src/lib/db/schema.ts` | +tabelas `metaAdsets`, `metaAds`, `metaAdInsightsDaily`; +campos em `metaConnections` |
| `app/src/lib/integrations/meta.ts` | sync de conta/adsets/ads/criativos/insights ad-level + alerta de saldo |
| `app/src/lib/integrations/meta-metrics.ts` (novo) | helpers puros de métricas (CTR, CPM, CPL, mapeamento de `actions`) |
| `app/src/server/actions/campaigns.ts` | +`saveBalanceAlert`, +`exportTrafegoCsv` |
| `app/src/components/charts/bar-line.tsx` (novo) | gráfico SVG combo (barras+linha), sem dependência |
| `app/src/app/(app)/campanhas/trafego-filters.tsx` (novo) | filtros client (período/de/até/conta/campanha) |
| `app/src/app/(app)/campanhas/tabs.tsx` (novo) | navegação de abas (links `?aba=`) |
| `app/src/app/(app)/campanhas/page.tsx` | shell: header + filtros + abas; delega para componentes de aba |
| `app/src/app/(app)/campanhas/_tabs/resumo.tsx` (novo) | aba Resumo |
| `app/src/app/(app)/campanhas/_tabs/campanhas.tsx` (novo) | aba Campanhas (CRM + Gerenciador) |
| `app/src/app/(app)/campanhas/_tabs/criativos.tsx` (novo) | aba Anúncios e criativos |
| `app/src/app/(app)/campanhas/_tabs/whatsapp.tsx` (novo) | aba WhatsApp |
| `app/src/app/(app)/campanhas/_tabs/vinculos.tsx` (novo) | aba Vínculos |
| `app/src/app/(app)/campanhas/_tabs/alerta-saldo.tsx` (novo) | aba Alerta de saldo + form |
| `app/src/lib/trafego.ts` (novo) | tipos + resolução de período/filtros compartilhados pelas abas |

---

## Task 1: Schema — novas tabelas e campos

**Files:**
- Modify: `app/src/lib/db/schema.ts` (após o bloco `metaInsightsDaily`, ~linha 604; e dentro de `metaConnections`, ~linha 552)

- [ ] **Step 1: Adicionar campos de conta/alerta em `metaConnections`**

No objeto `metaConnections` (após `lastError: text("last_error"),`), adicionar:

```ts
    accountName: text("account_name"),
    currency: text("currency").notNull().default("BRL"),
    accountStatus: text("account_status"),
    fundingType: text("funding_type"), // 'prepaid' | 'postpaid' | null
    balanceCents: integer("balance_cents"),
    spendCapCents: integer("spend_cap_cents"),
    pageName: text("page_name"),
    lowBalanceAlertCents: integer("low_balance_alert_cents"),
    alertPhone: text("alert_phone"),
    alertEnabled: boolean("alert_enabled").notNull().default(false),
    lastBalanceAlertAt: ts("last_balance_alert_at"),
```

- [ ] **Step 2: Adicionar as novas tabelas após `metaInsightsDaily`**

```ts
export const metaAdsets = pgTable(
  "meta_adsets",
  {
    id: id(),
    companyId: companyRef(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => metaConnections.id),
    metaAdsetId: text("meta_adset_id").notNull(),
    metaCampaignId: text("meta_campaign_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    dailyBudgetCents: integer("daily_budget_cents"),
    lifetimeBudgetCents: integer("lifetime_budget_cents"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("meta_adsets_uq").on(t.companyId, t.metaAdsetId)],
);

export const metaAds = pgTable(
  "meta_ads",
  {
    id: id(),
    companyId: companyRef(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => metaConnections.id),
    metaAdId: text("meta_ad_id").notNull(),
    metaAdsetId: text("meta_adset_id").notNull(),
    metaCampaignId: text("meta_campaign_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    creativeId: text("creative_id"),
    thumbnailUrl: text("thumbnail_url"),
    title: text("title"),
    body: text("body"),
    channel: text("channel"), // página / @instagram derivado do creative
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("meta_ads_uq").on(t.companyId, t.metaAdId)],
);

export const metaAdInsightsDaily = pgTable(
  "meta_ad_insights_daily",
  {
    id: id(),
    companyId: companyRef(),
    metaAdId: text("meta_ad_id").notNull(),
    metaAdsetId: text("meta_adset_id").notNull(),
    metaCampaignId: text("meta_campaign_id").notNull(),
    date: date("date").notNull(),
    spendCents: integer("spend_cents").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    linkClicks: integer("link_clicks").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    messagesStarted: integer("messages_started").notNull().default(0),
    reactions: integer("reactions").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    videoViews: integer("video_views").notNull().default(0),
    postEngagement: integer("post_engagement").notNull().default(0),
  },
  (t) => [
    uniqueIndex("meta_ad_insights_uq").on(t.companyId, t.metaAdId, t.date),
    index("meta_ad_insights_campaign_idx").on(t.companyId, t.metaCampaignId, t.date),
    index("meta_ad_insights_date_idx").on(t.companyId, t.date),
  ],
);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (0 erros)

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(trafego): schema de adsets, ads e insights ad-level + campos de conta/alerta"
```

---

## Task 2: Migration

**Files:**
- Create: `app/drizzle/XXXX_*.sql` (gerado pelo drizzle-kit)

- [ ] **Step 1: Gerar a migration**

Run: `npm run db:generate`
Expected: cria um novo arquivo em `app/drizzle/` com os `CREATE TABLE meta_adsets/meta_ads/meta_ad_insights_daily` e os `ALTER TABLE meta_connections ADD COLUMN ...`.

- [ ] **Step 2: Revisar o SQL gerado**

Abrir o arquivo novo em `app/drizzle/` e conferir: 3 CREATE TABLE + 11 ADD COLUMN em `meta_connections`, mais os índices. Nenhum DROP.

- [ ] **Step 3: Aplicar a migration**

O `scripts/migrate.ts` precisa de `DATABASE_URL`. Carregar o `.env.local` e rodar:

```bash
set -a; . ./.env.local; set +a; npm run db:migrate
```
Expected: "migrations applied" sem erro. (Projeto Neon: shy-king-99866532/production.)

- [ ] **Step 4: Verificar no banco (via MCP Neon ou psql)**

Conferir que `meta_ad_insights_daily` existe e que `meta_connections` tem a coluna `funding_type`.

- [ ] **Step 5: Commit**

```bash
git add drizzle/
git commit -m "feat(trafego): migration das novas tabelas e colunas Meta"
```

---

## Task 3: Helpers de métricas (puros)

**Files:**
- Create: `app/src/lib/integrations/meta-metrics.ts`

- [ ] **Step 1: Criar o módulo de métricas**

```ts
import "server-only";

/** Tipos de action da Meta usados nas métricas. */
export const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
export const MSG_ACTIONS = ["onsite_conversion.messaging_conversation_started_7d"];

export type MetaAction = { action_type: string; value: string };

/** Soma actions de tipos que podem se sobrepor: usa o MAIOR valor entre os tipos. */
export function maxAction(actions: MetaAction[] | undefined, types: string[]) {
  return Math.round((actions ?? []).filter((a) => types.includes(a.action_type)).reduce((s, a) => Math.max(s, Number(a.value)), 0));
}

/** Soma simples de UM tipo de action (0 se ausente). */
export function oneAction(actions: MetaAction[] | undefined, type: string) {
  const a = (actions ?? []).find((x) => x.action_type === type);
  return a ? Math.round(Number(a.value)) : 0;
}

/** Mapeia o array `actions` nos campos de engajamento da nossa tabela. */
export function mapEngagement(actions: MetaAction[] | undefined) {
  return {
    leads: maxAction(actions, LEAD_ACTIONS),
    messagesStarted: maxAction(actions, MSG_ACTIONS),
    linkClicks: oneAction(actions, "link_click"),
    reactions: oneAction(actions, "post_reaction"),
    comments: oneAction(actions, "comment"),
    shares: oneAction(actions, "post"),
    saves: oneAction(actions, "onsite_conversion.post_save"),
    videoViews: oneAction(actions, "video_view"),
    postEngagement: oneAction(actions, "post_engagement"),
  };
}

/** Derivadas a partir de agregados (cents de gasto, inteiros de impressão/clique/lead). */
export function ctr(clicks: number, impressions: number) {
  return impressions ? clicks / impressions : 0;
}
export function cpmCents(spendCents: number, impressions: number) {
  return impressions ? Math.round((spendCents / impressions) * 1000) : 0;
}
export function cplCents(spendCents: number, leads: number) {
  return leads ? Math.round(spendCents / leads) : 0;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/meta-metrics.ts
git commit -m "feat(trafego): helpers de métricas Meta (CTR/CPM/CPL, mapeamento de actions)"
```

---

## Task 4: Coleta — info da conta + adsets + ads/criativos + insights ad-level

**Files:**
- Modify: `app/src/lib/integrations/meta.ts`

- [ ] **Step 1: Importar helpers e refatorar o sumActions existente**

No topo, adicionar import e remover as constantes duplicadas (`LEAD_ACTIONS`, `MSG_ACTIONS`, `sumActions`) substituindo pelo helper:

```ts
import { mapEngagement, maxAction, LEAD_ACTIONS, MSG_ACTIONS } from "./meta-metrics";
```

Substituir usos de `sumActions(i.actions, LEAD_ACTIONS)` por `maxAction(i.actions, LEAD_ACTIONS)` e `sumActions(i.actions, MSG_ACTIONS)` por `maxAction(i.actions, MSG_ACTIONS)` nas funções que já existem (`syncMetaConnection` e `backfillMetaMonth`). Apagar a função local `sumActions` e as constantes locais.

- [ ] **Step 2: Adicionar coleta de info da conta dentro de `syncMetaConnection`**

Logo após `const token = decrypt(conn.accessTokenEnc);`, antes do laço de campanhas:

```ts
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
```

- [ ] **Step 3: Coletar adsets (depois do laço de campanhas, antes dos insights campanha)**

```ts
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
```

- [ ] **Step 4: Coletar ads + creative**

```ts
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
```

- [ ] **Step 5: Coletar insights ad-level (últimos 30 dias)**

```ts
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
```

- [ ] **Step 6: Gravar info da conta no update final de `metaConnections`**

Localizar o `.update(schema.metaConnections).set({ lastSyncAt: new Date(), lastError: null, status: "connected" })` e expandir o `set`:

```ts
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
```

> Observação: a Meta devolve `balance`/`spend_cap` já em centavos da moeda da conta — não multiplicar por 100.

- [ ] **Step 7: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS (build compila a rota existente).

- [ ] **Step 8: Commit**

```bash
git add src/lib/integrations/meta.ts
git commit -m "feat(trafego): coleta de conta, adsets, ads/criativos e insights ad-level"
```

---

## Task 5: Alerta de saldo dentro do sync

**Files:**
- Modify: `app/src/lib/integrations/meta.ts`
- Modify (import): usar `sendText` de `./whatsapp` e ler `whatsapp_accounts`

- [ ] **Step 1: Criar função `maybeAlertLowBalance`**

Adicionar no fim de `meta.ts`:

```ts
import { decrypt } from "@/lib/crypto"; // (já importado no topo — não duplicar)
import { sendText } from "./whatsapp";

const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/** Envia WhatsApp se a conta pré-paga estiver abaixo do limite configurado (com cooldown). */
export async function maybeAlertLowBalance(conn: typeof schema.metaConnections.$inferSelect) {
  if (conn.fundingType !== "prepaid" || !conn.alertEnabled || !conn.alertPhone) return;
  if (conn.lowBalanceAlertCents == null || conn.balanceCents == null) return;
  if (conn.balanceCents >= conn.lowBalanceAlertCents) return;
  if (conn.lastBalanceAlertAt && Date.now() - conn.lastBalanceAlertAt.getTime() < ALERT_COOLDOWN_MS) return;

  const wa = await db.query.whatsappAccounts.findFirst({ where: eq(schema.whatsappAccounts.companyId, conn.companyId) });
  if (!wa || wa.status !== "connected") return;
  const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: conn.currency ?? "BRL" });
  const body = `⚠️ Saldo baixo na conta de anúncios ${conn.accountName ?? conn.adAccountId}: ${money(conn.balanceCents)} (limite ${money(conn.lowBalanceAlertCents)}). Recarregue para os anúncios não pausarem.`;
  try {
    await sendText(wa.phoneNumberId, decrypt(wa.accessTokenEnc), conn.alertPhone, body);
    await db.update(schema.metaConnections).set({ lastBalanceAlertAt: new Date() }).where(eq(schema.metaConnections.id, conn.id));
  } catch {
    // não falha o sync por erro de WhatsApp
  }
}
```

> Confirmar os nomes reais das colunas de `whatsapp_accounts` (`phoneNumberId`, `accessTokenEnc`, `status`) em `schema.ts` e ajustar se diferirem.

- [ ] **Step 2: Chamar o alerta ao fim do sync**

No fim de `syncMetaConnection`, após o `.update(...)` da conexão e antes do `return`, recarregar a conn e chamar:

```ts
    const fresh = await db.query.metaConnections.findFirst({ where: eq(schema.metaConnections.id, conn.id) });
    if (fresh) await maybeAlertLowBalance(fresh);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/integrations/meta.ts
git commit -m "feat(trafego): alerta de saldo baixo por WhatsApp dentro do sync"
```

---

## Task 6: Módulo compartilhado de período/filtros

**Files:**
- Create: `app/src/lib/trafego.ts`

- [ ] **Step 1: Criar o resolvedor de período e tipos de filtro**

```ts
import "server-only";
import { todayISO } from "@/lib/utils";

export type TrafegoSearch = {
  aba?: string;
  periodo?: string; // 'hoje' | '7' | '14' | '30' | 'mes' | 'custom'
  de?: string;
  ate?: string;
  conta?: string; // connectionId | undefined (todas)
  campanha?: string; // metaCampaignId | undefined (todas)
  grao?: string; // 'campanha' | 'conjunto' | 'anuncio'
  comparar?: string;
  detalhar?: string; // 'dia' | 'semana' | 'mes'
  ordenar?: string;
};

export const ABAS = [
  ["resumo", "Resumo"],
  ["campanhas", "Campanhas"],
  ["criativos", "Anúncios e criativos"],
  ["whatsapp", "WhatsApp"],
  ["vinculos", "Vínculos"],
  ["alerta", "Alerta de saldo"],
] as const;

/** Converte os filtros de período num intervalo [since, until] em YYYY-MM-DD (fuso local). */
export function resolvePeriod(sp: TrafegoSearch): { since: string; until: string; days: number; label: string } {
  const today = todayISO();
  const daysAgo = (n: number) => todayISO(undefined, new Date(Date.now() - n * 86_400_000));
  switch (sp.periodo) {
    case "hoje":
      return { since: today, until: today, days: 1, label: "Hoje" };
    case "7":
      return { since: daysAgo(6), until: today, days: 7, label: "Últimos 7 dias" };
    case "14":
      return { since: daysAgo(13), until: today, days: 14, label: "Últimos 14 dias" };
    case "mes": {
      const d = new Date();
      const since = todayISO(undefined, new Date(d.getFullYear(), d.getMonth(), 1));
      return { since, until: today, days: 31, label: "Este mês" };
    }
    case "custom":
      if (sp.de && sp.ate) {
        const days = Math.max(1, Math.round((Date.parse(sp.ate) - Date.parse(sp.de)) / 86_400_000) + 1);
        return { since: sp.de, until: sp.ate, days, label: "Personalizado" };
      }
    // fallthrough para o default
    default:
      return { since: daysAgo(29), until: today, days: 30, label: "Últimos 30 dias" };
  }
}

/** Período anterior de mesmo tamanho (para comparação). */
export function previousPeriod(since: string, until: string) {
  const len = Math.round((Date.parse(until) - Date.parse(since)) / 86_400_000) + 1;
  const prevUntil = new Date(Date.parse(since) - 86_400_000);
  const prevSince = new Date(prevUntil.getTime() - (len - 1) * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { since: iso(prevSince), until: iso(prevUntil) };
}
```

> Conferir a assinatura real de `todayISO` em `@/lib/utils` (o `page.tsx` atual usa `todayISO(undefined, new Date(...))`). Ajustar se divergir.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/trafego.ts
git commit -m "feat(trafego): resolvedor de período e filtros compartilhados"
```

---

## Task 7: Gráfico SVG combo (barras + linha)

**Files:**
- Create: `app/src/components/charts/bar-line.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
type Point = { label: string; bar: number; line: number };

/** Gráfico combo sem dependência: barras (esq.) + linha (dir.). Valores já formatados fora. */
export function BarLineChart({ data, barLabel, lineLabel, height = 240 }: { data: Point[]; barLabel: string; lineLabel: string; height?: number }) {
  if (!data.length) return <p className="p-6 text-sm text-muted">Sem dados no período.</p>;
  const w = Math.max(data.length * 36, 320);
  const pad = { t: 10, r: 8, b: 24, l: 8 };
  const innerH = height - pad.t - pad.b;
  const maxBar = Math.max(1, ...data.map((d) => d.bar));
  const maxLine = Math.max(1, ...data.map((d) => d.line));
  const bw = (w - pad.l - pad.r) / data.length;
  const x = (i: number) => pad.l + i * bw + bw / 2;
  const yBar = (v: number) => pad.t + innerH - (v / maxBar) * innerH;
  const yLine = (v: number) => pad.t + innerH - (v / maxLine) * innerH;
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${yLine(d.line)}`).join(" ");

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={height} role="img" aria-label={`${barLabel} x ${lineLabel}`} className="min-w-full">
        {data.map((d, i) => (
          <rect key={i} x={x(i) - bw * 0.3} y={yBar(d.bar)} width={bw * 0.6} height={pad.t + innerH - yBar(d.bar)} rx={2} className="fill-teal-600/80" />
        ))}
        <path d={path} fill="none" className="stroke-teal-900" strokeWidth={2} />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={yLine(d.line)} r={2.5} className="fill-teal-900" />
        ))}
        {data.map((d, i) => (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-muted text-[9px]">
            {d.label}
          </text>
        ))}
      </svg>
      <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-teal-600/80" /> {barLabel}</span>
        <span className="inline-flex items-center gap-1"><span className="h-0.5 w-3 bg-teal-900" /> {lineLabel}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/charts/bar-line.tsx
git commit -m "feat(trafego): gráfico SVG combo barras+linha"
```

---

## Task 8: Filtros client + navegação de abas

**Files:**
- Create: `app/src/app/(app)/campanhas/trafego-filters.tsx`
- Create: `app/src/app/(app)/campanhas/tabs.tsx`

- [ ] **Step 1: Criar `tabs.tsx`**

```tsx
import Link from "next/link";
import { ABAS } from "@/lib/trafego";
import { cn } from "@/lib/utils";

export function Tabs({ active, query }: { active: string; query: string }) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-xl bg-surface p-1 text-sm">
      {ABAS.map(([key, label]) => (
        <Link key={key} href={`/campanhas?aba=${key}${query}`} className={cn("rounded-lg px-3 py-1.5", active === key ? "bg-brand-500 text-white" : "text-muted hover:bg-brand-50")}>
          {label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Criar `trafego-filters.tsx` (client)**

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";

const PERIODS: [string, string][] = [
  ["hoje", "Hoje"],
  ["7", "Últimos 7 dias"],
  ["14", "Últimos 14 dias"],
  ["30", "Últimos 30 dias"],
  ["mes", "Este mês"],
  ["custom", "Personalizado"],
];

export function TrafegoFilters({
  contas,
  campanhas,
}: {
  contas: { id: string; name: string }[];
  campanhas: { id: string; name: string }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.push(`/campanhas?${next.toString()}`);
  };
  const val = (k: string, d = "") => sp.get(k) ?? d;

  return (
    <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Período
        <select className="input w-44" value={val("periodo", "30")} onChange={(e) => set("periodo", e.target.value)}>
          {PERIODS.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        De
        <input type="date" className="input w-40" value={val("de")} onChange={(e) => { set("de", e.target.value); }} onBlur={() => set("periodo", "custom")} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Até
        <input type="date" className="input w-40" value={val("ate")} onChange={(e) => set("ate", e.target.value)} onBlur={() => set("periodo", "custom")} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Conta
        <select className="input w-52" value={val("conta")} onChange={(e) => set("conta", e.target.value)}>
          <option value="">Todas as contas</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Campanha
        <select className="input w-56" value={val("campanha")} onChange={(e) => set("campanha", e.target.value)}>
          <option value="">Todas as campanhas</option>
          {campanhas.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/campanhas/tabs.tsx" "src/app/(app)/campanhas/trafego-filters.tsx"
git commit -m "feat(trafego): filtros client e navegação de abas"
```

---

## Task 9: Shell da página (header + filtros + abas)

**Files:**
- Modify: `app/src/app/(app)/campanhas/page.tsx` (reescrever como shell que despacha para abas)

- [ ] **Step 1: Reescrever `page.tsx`**

```tsx
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Empty, PageHeader } from "@/components/ui";
import Link from "next/link";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/utils";
import { type TrafegoSearch } from "@/lib/trafego";
import { syncMetaNow } from "@/server/actions/campaigns";
import { BackfillButton } from "./backfill-button";
import { TrafegoFilters } from "./trafego-filters";
import { Tabs } from "./tabs";
import { ResumoTab } from "./_tabs/resumo";
import { CampanhasTab } from "./_tabs/campanhas";
import { CriativosTab } from "./_tabs/criativos";
import { WhatsappTab } from "./_tabs/whatsapp";
import { VinculosTab } from "./_tabs/vinculos";
import { AlertaSaldoTab } from "./_tabs/alerta-saldo";

export const metadata = { title: "Tráfego pago" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<TrafegoSearch> }) {
  const ctx = await getContext();
  if (!can(ctx, "campaigns.view")) redirect("/dashboard");
  const sp = await searchParams;
  const aba = sp.aba ?? "resumo";

  const conns = await db.select().from(schema.metaConnections).where(eq(schema.metaConnections.companyId, ctx.companyId));
  if (!conns.length)
    return (
      <>
        <PageHeader title="Tráfego pago" />
        <Empty>
          Conecte a conta de anúncios da Meta em{" "}
          <Link href="/configuracoes/integracoes" className="text-brand-600 underline">
            Configurações → Integrações
          </Link>{" "}
          para ver investimento, leads e retorno de cada campanha.
        </Empty>
      </>
    );

  const campaigns = await db.select({ id: schema.metaCampaigns.metaCampaignId, name: schema.metaCampaigns.name }).from(schema.metaCampaigns).where(eq(schema.metaCampaigns.companyId, ctx.companyId));
  const lastSync = conns.map((c) => c.lastSyncAt).filter(Boolean).sort().at(-1);
  const query = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "aba" && v) as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Tráfego pago"
        subtitle={`Meta Ads (somente leitura) cruzado com leads, agendamentos e vendas do CRM. ${lastSync ? `Última coleta em ${fmtDateTime(lastSync)}` : "ainda não sincronizado"}`}
        actions={
          <>
            <BackfillButton />
            <ActionButton action={syncMetaNow} className="btn-primary">
              Atualizar agora
            </ActionButton>
          </>
        }
      />
      <TrafegoFilters contas={conns.map((c) => ({ id: c.id, name: c.accountName ?? c.adAccountId }))} campanhas={campaigns} />
      <Tabs active={aba} query={query ? `&${query}` : ""} />
      {aba === "resumo" && <ResumoTab ctx={ctx} sp={sp} />}
      {aba === "campanhas" && <CampanhasTab ctx={ctx} sp={sp} />}
      {aba === "criativos" && <CriativosTab ctx={ctx} sp={sp} />}
      {aba === "whatsapp" && <WhatsappTab ctx={ctx} sp={sp} />}
      {aba === "vinculos" && <VinculosTab ctx={ctx} sp={sp} conns={conns} />}
      {aba === "alerta" && <AlertaSaldoTab ctx={ctx} conns={conns} />}
    </>
  );
}
```

> `ctx` é o tipo retornado por `getContext()`. Importar/derivar o tipo via `Awaited<ReturnType<typeof getContext>>` em cada aba (ver tasks seguintes). Cada aba inexistente ainda não compila — as Tasks 10-15 criam os arquivos. Execute o typecheck só após criar os stubs (próximo passo).

- [ ] **Step 2: Criar stubs mínimos das 6 abas para compilar**

Criar `app/src/app/(app)/campanhas/_tabs/<nome>.tsx` com um placeholder que será substituído:

```tsx
// resumo.tsx (repetir para campanhas/criativos/whatsapp com assinatura equivalente)
import type { getContext } from "@/lib/auth";
import type { TrafegoSearch } from "@/lib/trafego";
type Ctx = Awaited<ReturnType<typeof getContext>>;
export async function ResumoTab({ ctx, sp }: { ctx: Ctx; sp: TrafegoSearch }) {
  void ctx; void sp;
  return <div className="card p-6 text-sm text-muted">Em construção.</div>;
}
```

`vinculos.tsx` e `alerta-saldo.tsx` recebem também `conns`:

```tsx
import type { getContext } from "@/lib/auth";
import type { schema } from "@/lib/db";
type Ctx = Awaited<ReturnType<typeof getContext>>;
type Conn = typeof schema.metaConnections.$inferSelect;
export async function VinculosTab({ ctx, sp, conns }: { ctx: Ctx; sp: import("@/lib/trafego").TrafegoSearch; conns: Conn[] }) {
  void ctx; void sp; void conns;
  return <div className="card p-6 text-sm text-muted">Em construção.</div>;
}
```

(`AlertaSaldoTab` igual, só com `{ ctx, conns }`.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS (página compila, abas mostram "Em construção").

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/campanhas/"
git commit -m "feat(trafego): shell da página com header, filtros e abas (stubs)"
```

---

## Task 10: Aba Resumo

**Files:**
- Modify: `app/src/app/(app)/campanhas/_tabs/resumo.tsx`

- [ ] **Step 1: Implementar a aba com StatCards + gráfico**

```tsx
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
  const tot = daily.reduce((s, d) => ({ spend: s.spend + d.spend, impressions: s.impressions + d.impressions, clicks: s.clicks + d.clicks, leads: s.leads + d.leads }), { spend: 0, impressions: 0, clicks: 0, leads: 0 });
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
```

> Conferir que `StatCard` aceita a prop `hint` (o `page.tsx` atual já usa `hint`). Conferir a assinatura de `money` (recebe centavos).

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/campanhas/_tabs/resumo.tsx"
git commit -m "feat(trafego): aba Resumo com cards e gráfico diário"
```

---

## Task 11: Aba Campanhas (CRM + Gerenciador)

**Files:**
- Modify: `app/src/app/(app)/campanhas/_tabs/campanhas.tsx`

- [ ] **Step 1: Implementar as duas tabelas**

```tsx
import { sql } from "drizzle-orm";
import Link from "next/link";
import { Empty } from "@/components/ui";
import type { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { cn, money } from "@/lib/utils";
import { resolvePeriod, type TrafegoSearch } from "@/lib/trafego";

type Ctx = Awaited<ReturnType<typeof getContext>>;
const nf = new Intl.NumberFormat("pt-BR");

export async function CampanhasTab({ ctx, sp }: { ctx: Ctx; sp: TrafegoSearch }) {
  const { since, until } = resolvePeriod(sp);
  const campFilter = sp.campanha ? sql`and c.meta_campaign_id = ${sp.campanha}` : sql``;

  // (a) Resultado real no CRM (nível campanha)
  const crm = await db.execute(sql`
    select c.meta_campaign_id, c.name,
      coalesce(sum(i.spend_cents),0)::bigint as spend,
      coalesce(sum(i.leads + i.messages_started),0)::bigint as meta_leads,
      (select count(*) from contacts ct where ct.company_id = c.company_id and ct.deleted_at is null and ct.meta_campaign_id = c.meta_campaign_id) as crm_leads,
      (select count(distinct a.contact_id) from appointments a join contacts ct on ct.id = a.contact_id where ct.company_id = c.company_id and ct.meta_campaign_id = c.meta_campaign_id) as scheduled,
      (select count(distinct a.contact_id) from appointments a join contacts ct on ct.id = a.contact_id where ct.company_id = c.company_id and ct.meta_campaign_id = c.meta_campaign_id and a.status = 'completed') as attended,
      (select count(*) from deals d join contacts ct on ct.id = d.contact_id where ct.company_id = c.company_id and ct.meta_campaign_id = c.meta_campaign_id and d.won_at is not null) as won,
      (select coalesce(sum(o.total_cents),0) from orders o join contacts ct on ct.id = o.contact_id where ct.company_id = c.company_id and ct.meta_campaign_id = c.meta_campaign_id and o.status in ('confirmed','paid')) as revenue
    from meta_campaigns c
    left join meta_insights_daily i on i.company_id = c.company_id and i.meta_campaign_id = c.meta_campaign_id and i.date >= ${since} and i.date <= ${until}
    where c.company_id = ${ctx.companyId} ${campFilter}
    group by c.id order by spend desc, c.name
  `);
  const crmRows = (crm.rows as Record<string, unknown>[]).map((r) => {
    const spend = Number(r.spend);
    const crmLeads = Number(r.crm_leads);
    const revenue = Number(r.revenue);
    return {
      id: String(r.meta_campaign_id), name: String(r.name), spend,
      metaLeads: Number(r.meta_leads), crmLeads, scheduled: Number(r.scheduled), attended: Number(r.attended), won: Number(r.won), revenue,
      cplReal: crmLeads ? Math.round(spend / crmLeads) : 0,
      roi: spend ? revenue / spend : 0,
    };
  }).filter((r) => r.spend > 0 || r.crmLeads > 0);

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
    where ai.company_id = ${ctx.companyId} and ai.date >= ${since} and ai.date <= ${until} ${campFilterAi}
    group by key order by spend desc
  `);
  const mgrRows = (mgr.rows as Record<string, unknown>[]).map((r) => {
    const spend = Number(r.spend); const impressions = Number(r.impressions); const clicks = Number(r.clicks); const leads = Number(r.leads);
    return {
      key: String(r.key), name: String(r.name ?? r.key), status: String(r.status ?? ""),
      spend, impressions, reach: Number(r.reach), clicks, linkClicks: Number(r.link_clicks),
      reactions: Number(r.reactions), comments: Number(r.comments), shares: Number(r.shares), saves: Number(r.saves), videoViews: Number(r.video_views), postEngagement: Number(r.post_engagement),
      leads, ctr: impressions ? (clicks / impressions) * 100 : 0, cpm: impressions ? Math.round((spend / impressions) * 1000) : 0, cpl: leads ? Math.round(spend / leads) : 0,
    };
  });

  const graoLink = (g: string) => `/campanhas?aba=campanhas&grao=${g}${sp.periodo ? `&periodo=${sp.periodo}` : ""}${sp.campanha ? `&campanha=${sp.campanha}` : ""}`;

  return (
    <div className="space-y-8">
      <section className="card overflow-x-auto">
        <h3 className="p-4 text-sm font-semibold">Campanhas e resultado real no CRM</h3>
        {crmRows.length === 0 ? (
          <Empty>Nenhuma campanha com dados no período.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Campanha</th><th className="text-right">Investido</th><th className="text-right">Leads Meta</th><th className="text-right">Leads CRM</th>
                <th className="text-right">Agendaram</th><th className="text-right">Compareceram</th><th className="text-right">Fecharam</th>
                <th className="text-right">Vendido</th><th className="text-right">Custo/lead real</th><th className="text-right">ROI</th>
              </tr>
            </thead>
            <tbody>
              {crmRows.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.name}</td>
                  <td className="text-right">{money(c.spend)}</td>
                  <td className="text-right">{c.metaLeads}</td>
                  <td className="text-right">{c.crmLeads}</td>
                  <td className="text-right">{c.scheduled}</td>
                  <td className="text-right">{c.attended}</td>
                  <td className="text-right font-semibold text-green-600">{c.won}</td>
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
          <div className="flex gap-1 rounded-lg bg-surface p-1 text-sm">
            {[["campanha", "Campanhas"], ["conjunto", "Conjuntos"], ["anuncio", "Anúncios"]].map(([g, l]) => (
              <Link key={g} href={graoLink(g)} className={cn("rounded-md px-3 py-1", grao === g ? "bg-brand-500 text-white" : "text-muted")}>{l}</Link>
            ))}
          </div>
        </div>
        {mgrRows.length === 0 ? (
          <Empty>Sem dados nível anúncio no período. Clique em "Atualizar agora" ou importe o histórico.</Empty>
        ) : (
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{grao === "anuncio" ? "Anúncio" : grao === "conjunto" ? "Conjunto" : "Campanha"}</th><th>Status</th>
                <th className="text-right">Investido</th><th className="text-right">Impressões</th><th className="text-right">Alcance</th><th className="text-right">Cliques</th>
                <th className="text-right">CTR</th><th className="text-right">CPM</th><th className="text-right">Reações</th><th className="text-right">Coment.</th><th className="text-right">Compart.</th>
                <th className="text-right">Salvos</th><th className="text-right">Vídeo</th><th className="text-right">Engaj.</th><th className="text-right">Clique link</th><th className="text-right">Lead Meta</th><th className="text-right">CPL</th>
              </tr>
            </thead>
            <tbody>
              {mgrRows.map((r) => (
                <tr key={r.key}>
                  <td className="font-medium">{r.name}</td><td className="text-xs text-muted">{r.status}</td>
                  <td className="text-right">{money(r.spend)}</td><td className="text-right">{nf.format(r.impressions)}</td><td className="text-right">{nf.format(r.reach)}</td><td className="text-right">{nf.format(r.clicks)}</td>
                  <td className="text-right">{r.ctr.toFixed(1)}%</td><td className="text-right">{money(r.cpm)}</td><td className="text-right">{nf.format(r.reactions)}</td><td className="text-right">{nf.format(r.comments)}</td><td className="text-right">{nf.format(r.shares)}</td>
                  <td className="text-right">{nf.format(r.saves)}</td><td className="text-right">{nf.format(r.videoViews)}</td><td className="text-right">{nf.format(r.postEngagement)}</td><td className="text-right">{nf.format(r.linkClicks)}</td><td className="text-right">{r.leads}</td><td className="text-right">{r.cpl ? money(r.cpl) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="p-3">
          <a href={`/campanhas/export?${new URLSearchParams({ grao, periodo: sp.periodo ?? "30", ...(sp.campanha ? { campanha: sp.campanha } : {}) }).toString()}`} className="btn-secondary inline-flex items-center gap-2 text-sm">
            Exportar CSV (Excel)
          </a>
        </div>
      </section>
    </div>
  );
}
```

> Conferir no schema os nomes reais: `appointments.status` (valor "completed"?), `deals.won_at`, `orders.status`/`total_cents`. Ajustar os valores de status conforme o enum real do projeto (o `page.tsx` atual já usa `d.won_at is not null` e `o.status in ('confirmed','paid')` — reusar exatamente esses).

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/campanhas/_tabs/campanhas.tsx"
git commit -m "feat(trafego): aba Campanhas com tabela CRM e tabela estilo Gerenciador"
```

---

## Task 12: Export CSV + comparação de período

**Files:**
- Create: `app/src/app/(app)/campanhas/export/route.ts`
- Modify: `app/src/app/(app)/campanhas/_tabs/campanhas.tsx` (adicionar coluna de delta quando `comparar=1`)

- [ ] **Step 1: Criar a rota de export CSV**

```ts
import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { resolvePeriod } from "@/lib/trafego";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!can(ctx, "campaigns.view")) return new NextResponse("forbidden", { status: 403 });
  const p = Object.fromEntries(req.nextUrl.searchParams);
  const { since, until } = resolvePeriod(p);
  const grao = p.grao ?? "campanha";
  const groupCol = grao === "anuncio" ? sql`ai.meta_ad_id` : grao === "conjunto" ? sql`ai.meta_adset_id` : sql`ai.meta_campaign_id`;
  const nameJoin =
    grao === "anuncio" ? sql`left join meta_ads n on n.company_id = ai.company_id and n.meta_ad_id = ai.meta_ad_id`
    : grao === "conjunto" ? sql`left join meta_adsets n on n.company_id = ai.company_id and n.meta_adset_id = ai.meta_adset_id`
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
```

> O `_tabs/campanhas.tsx` da Task 11 já aponta para `/campanhas/export` — conferir que o caminho bate.

- [ ] **Step 2: (Comparação) adicionar coluna de delta na tabela Gerenciador**

No `_tabs/campanhas.tsx`, quando `sp.comparar === "1"`, rodar a mesma query do grão para `previousPeriod(since, until)` e exibir ao lado do Investido a variação `% `. Adicionar antes do `return`:

```tsx
  // comparação opcional
  let prevSpendByKey: Record<string, number> = {};
  if (sp.comparar === "1") {
    const { since: ps, until: pu } = (await import("@/lib/trafego")).previousPeriod(since, until);
    const prev = await db.execute(sql`
      select ${groupCol} as key, coalesce(sum(ai.spend_cents),0)::bigint as spend
      from meta_ad_insights_daily ai where ai.company_id = ${ctx.companyId} and ai.date >= ${ps} and ai.date <= ${pu} ${campFilterAi} group by key
    `);
    prevSpendByKey = Object.fromEntries((prev.rows as Record<string, unknown>[]).map((r) => [String(r.key), Number(r.spend)]));
  }
```

E no cabeçalho adicionar um link toggle:

```tsx
<Link href={`${graoLink(grao)}${sp.comparar === "1" ? "" : "&comparar=1"}`} className="btn-secondary text-sm">
  {sp.comparar === "1" ? "Sem comparação" : "Comparar período anterior"}
</Link>
```

E na célula de Investido, quando comparando, anexar o delta:

```tsx
<td className="text-right">{money(r.spend)}{sp.comparar === "1" && prevSpendByKey[r.key] != null ? <span className={cn("ml-1 text-xs", r.spend >= prevSpendByKey[r.key] ? "text-green-600" : "text-red-600")}>{prevSpendByKey[r.key] ? `${(((r.spend - prevSpendByKey[r.key]) / prevSpendByKey[r.key]) * 100).toFixed(0)}%` : ""}</span> : null}</td>
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/campanhas/export/route.ts" "src/app/(app)/campanhas/_tabs/campanhas.tsx"
git commit -m "feat(trafego): export CSV e comparação de período na aba Campanhas"
```

---

## Task 13: Aba Anúncios e criativos

**Files:**
- Modify: `app/src/app/(app)/campanhas/_tabs/criativos.tsx`

- [ ] **Step 1: Implementar o grid de criativos**

```tsx
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
  const order = sp.ordenar ?? "investido";
  const orderSql = order === "leads" ? sql`leads desc` : order === "ctr" ? sql`ctr desc` : order === "cpl" ? sql`(case when leads>0 then spend/leads else 999999999 end) asc` : sql`spend desc`;
  const r = await db.execute(sql`
    select a.meta_ad_id, a.name, a.thumbnail_url, a.status, a.channel, cmp.name as campaign_name,
      coalesce(sum(ai.spend_cents),0)::bigint as spend, coalesce(sum(ai.impressions),0)::bigint as impressions,
      coalesce(sum(ai.clicks),0)::bigint as clicks, coalesce(sum(ai.leads + ai.messages_started),0)::bigint as leads,
      case when coalesce(sum(ai.impressions),0)>0 then (sum(ai.clicks)::float/sum(ai.impressions)) else 0 end as ctr
    from meta_ads a
    join meta_ad_insights_daily ai on ai.company_id = a.company_id and ai.meta_ad_id = a.meta_ad_id and ai.date >= ${since} and ai.date <= ${until}
    left join meta_campaigns cmp on cmp.company_id = a.company_id and cmp.meta_campaign_id = a.meta_campaign_id
    where a.company_id = ${ctx.companyId} ${campFilter}
    group by a.meta_ad_id, a.name, a.thumbnail_url, a.status, a.channel, cmp.name
    having coalesce(sum(ai.spend_cents),0) > 0
    order by ${orderSql}
  `);
  const ads = (r.rows as Record<string, unknown>[]).map((x) => {
    const spend = Number(x.spend); const impressions = Number(x.impressions); const leads = Number(x.leads);
    return { id: String(x.meta_ad_id), name: String(x.name), thumb: x.thumbnail_url ? String(x.thumbnail_url) : null, status: String(x.status ?? ""), channel: String(x.channel ?? ""), campaign: String(x.campaign_name ?? ""), spend, impressions, clicks: Number(x.clicks), leads, ctr: impressions ? (Number(x.clicks) / impressions) * 100 : 0, cpl: leads ? Math.round(spend / leads) : 0 };
  });
  const ordLink = (o: string) => `/campanhas?aba=criativos&ordenar=${o}${sp.periodo ? `&periodo=${sp.periodo}` : ""}${sp.campanha ? `&campanha=${sp.campanha}` : ""}`;

  if (!ads.length) return <Empty>Nenhum anúncio com investimento no período. Clique em "Atualizar agora".</Empty>;

  return (
    <>
      <div className="mb-4 flex items-center gap-2 text-sm">
        <span className="text-muted">Ordenar por:</span>
        {[["investido", "Investido"], ["leads", "Leads"], ["cpl", "CPL"], ["ctr", "CTR"]].map(([o, l]) => (
          <Link key={o} href={ordLink(o)} className={cn("rounded-md px-2 py-1", order === o ? "bg-brand-500 text-white" : "text-muted")}>{l}</Link>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ads.map((a) => (
          <div key={a.id} className="card overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {a.thumb ? <img src={a.thumb} alt={a.name} className="h-40 w-full object-cover" /> : <div className="flex h-40 items-center justify-center bg-surface text-xs text-muted">sem prévia</div>}
            <div className="space-y-1 p-3">
              <div className="truncate text-sm font-medium" title={a.name}>{a.name}</div>
              <div className="truncate text-xs text-muted">{a.campaign} · {a.channel} · {a.status}</div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-muted">Investido</span><span className="text-right font-medium">{money(a.spend)}</span>
                <span className="text-muted">Leads</span><span className="text-right font-medium">{a.leads}</span>
                <span className="text-muted">CPL</span><span className="text-right">{a.cpl ? money(a.cpl) : "—"}</span>
                <span className="text-muted">CTR</span><span className="text-right">{a.ctr.toFixed(1)}%</span>
                <span className="text-muted">Impressões</span><span className="text-right">{nf.format(a.impressions)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
```

> `next.config` pode restringir `next/image` a domínios — por isso usamos `<img>` com a URL temporária da Meta (thumbnails expiram; aceitável).

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/campanhas/_tabs/criativos.tsx"
git commit -m "feat(trafego): aba Anúncios e criativos (grid com thumbnails)"
```

---

## Task 14: Aba WhatsApp

**Files:**
- Modify: `app/src/app/(app)/campanhas/_tabs/whatsapp.tsx`

- [ ] **Step 1: Implementar a tabela de conversas por anúncio**

```tsx
import { sql } from "drizzle-orm";
import { Empty } from "@/components/ui";
import type { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/utils";
import { resolvePeriod, type TrafegoSearch } from "@/lib/trafego";

type Ctx = Awaited<ReturnType<typeof getContext>>;
const nf = new Intl.NumberFormat("pt-BR");

export async function WhatsappTab({ ctx, sp }: { ctx: Ctx; sp: TrafegoSearch }) {
  const { since, until } = resolvePeriod(sp);
  const campFilter = sp.campanha ? sql`and ai.meta_campaign_id = ${sp.campanha}` : sql``;
  const r = await db.execute(sql`
    select a.meta_ad_id, a.name, a.channel,
      coalesce(sum(ai.messages_started),0)::bigint as conversas,
      coalesce(sum(ai.spend_cents),0)::bigint as spend,
      (select count(*) from contacts ct where ct.company_id = a.company_id and ct.deleted_at is null and ct.meta_ad_id = a.meta_ad_id and ct.whatsapp is not null) as crm_leads
    from meta_ads a
    join meta_ad_insights_daily ai on ai.company_id = a.company_id and ai.meta_ad_id = a.meta_ad_id and ai.date >= ${since} and ai.date <= ${until}
    where a.company_id = ${ctx.companyId} ${campFilter}
    group by a.meta_ad_id, a.name, a.channel
    having coalesce(sum(ai.messages_started),0) > 0
    order by conversas desc
  `);
  const rows = (r.rows as Record<string, unknown>[]).map((x) => {
    const conversas = Number(x.conversas); const spend = Number(x.spend);
    return { id: String(x.meta_ad_id), name: String(x.name), channel: String(x.channel ?? ""), conversas, spend, custo: conversas ? Math.round(spend / conversas) : 0, crmLeads: Number(x.crm_leads) };
  });
  if (!rows.length) return <Empty>Nenhum anúncio com conversas de WhatsApp no período.</Empty>;

  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr><th>Anúncio</th><th>Canal</th><th className="text-right">Conversas WhatsApp</th><th className="text-right">Investido</th><th className="text-right">Custo/conversa</th><th className="text-right">Leads CRM</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="font-medium">{r.name}</td><td className="text-xs text-muted">{r.channel}</td>
              <td className="text-right">{nf.format(r.conversas)}</td><td className="text-right">{money(r.spend)}</td>
              <td className="text-right">{r.custo ? money(r.custo) : "—"}</td><td className="text-right font-semibold">{r.crmLeads}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/campanhas/_tabs/whatsapp.tsx"
git commit -m "feat(trafego): aba WhatsApp (conversas e custo por anúncio)"
```

---

## Task 15: Aba Vínculos

**Files:**
- Modify: `app/src/app/(app)/campanhas/_tabs/vinculos.tsx`

- [ ] **Step 1: Implementar a listagem de contas/páginas**

```tsx
import Link from "next/link";
import { Empty } from "@/components/ui";
import type { getContext } from "@/lib/auth";
import type { schema } from "@/lib/db";
import { fmtDateTime, money } from "@/lib/utils";

type Ctx = Awaited<ReturnType<typeof getContext>>;
type Conn = typeof schema.metaConnections.$inferSelect;

export async function VinculosTab({ ctx, conns }: { ctx: Ctx; sp: unknown; conns: Conn[] }) {
  void ctx;
  if (!conns.length) return <Empty>Nenhuma conta conectada.</Empty>;
  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Conta</th><th>Página</th><th>Moeda</th><th>Tipo</th><th className="text-right">Saldo</th><th>Status</th><th>Última sync</th></tr>
          </thead>
          <tbody>
            {conns.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.accountName ?? c.adAccountId}<div className="text-xs text-muted">{c.adAccountId}</div></td>
                <td>{c.pageName ?? (c.pageId ? c.pageId : "—")}</td>
                <td>{c.currency}</td>
                <td>{c.fundingType === "prepaid" ? "Pré-pago" : c.fundingType === "postpaid" ? "Pós-pago" : "—"}</td>
                <td className="text-right">{c.balanceCents != null ? money(c.balanceCents) : "—"}</td>
                <td>{c.lastError ? <span className="text-red-600">erro</span> : <span className="text-green-600">{c.status}</span>}</td>
                <td className="text-xs text-muted">{c.lastSyncAt ? fmtDateTime(c.lastSyncAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">Para adicionar ou remover contas e definir a página, use{" "}
        <Link href="/configuracoes/integracoes" className="text-brand-600 underline">Configurações → Integrações</Link>.
      </p>
    </div>
  );
}
```

> Decisão: a edição de conexão continua em Configurações → Integrações (reuso do `saveMeta`), e a aba Vínculos é a visão consolidada com link. Evita duplicar formulário.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/campanhas/_tabs/vinculos.tsx"
git commit -m "feat(trafego): aba Vínculos (contas/páginas conectadas)"
```

---

## Task 16: Aba Alerta de saldo + action `saveBalanceAlert`

**Files:**
- Modify: `app/src/server/actions/campaigns.ts` (adicionar `saveBalanceAlert`)
- Modify: `app/src/app/(app)/campanhas/_tabs/alerta-saldo.tsx`

- [ ] **Step 1: Adicionar a action `saveBalanceAlert`**

Em `campaigns.ts`:

```ts
export async function saveBalanceAlert(formData: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    if (!ctx.isMaster) throw new Error("Apenas o admin mestre configura o alerta de saldo.");
    const connectionId = String(formData.get("connectionId"));
    const enabled = formData.get("enabled") === "on";
    const limitReais = Number(String(formData.get("limit") ?? "0").replace(",", "."));
    const phone = String(formData.get("phone") ?? "").replace(/\D/g, "");
    await db
      .update(schema.metaConnections)
      .set({ alertEnabled: enabled, lowBalanceAlertCents: Math.round(limitReais * 100), alertPhone: phone || null })
      .where(eq(schema.metaConnections.id, connectionId));
    revalidatePath("/campanhas");
  });
}
```

- [ ] **Step 2: Implementar a aba (form só para master)**

```tsx
import { Empty } from "@/components/ui";
import { Field, Form, Submit } from "@/components/form";
import type { getContext } from "@/lib/auth";
import type { schema } from "@/lib/db";
import { money } from "@/lib/utils";
import { saveBalanceAlert } from "@/server/actions/campaigns";

type Ctx = Awaited<ReturnType<typeof getContext>>;
type Conn = typeof schema.metaConnections.$inferSelect;

export async function AlertaSaldoTab({ ctx, conns }: { ctx: Ctx; conns: Conn[] }) {
  if (!ctx.isMaster) return <Empty>Somente o admin mestre configura o alerta de saldo.</Empty>;
  const prepaid = conns.filter((c) => c.fundingType === "prepaid");
  const postpaid = conns.filter((c) => c.fundingType !== "prepaid");
  return (
    <div className="space-y-6">
      {prepaid.length === 0 && <Empty>Nenhuma conta pré-paga detectada. O alerta de saldo só se aplica a contas com recarga (boleto/pix).</Empty>}
      {prepaid.map((c) => (
        <section key={c.id} className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">{c.accountName ?? c.adAccountId}</h3>
            <span className="text-sm text-muted">Saldo atual: {c.balanceCents != null ? money(c.balanceCents) : "—"}</span>
          </div>
          <Form action={saveBalanceAlert} className="flex flex-wrap items-end gap-4">
            <input type="hidden" name="connectionId" value={c.id} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={c.alertEnabled} /> Ativar alerta
            </label>
            <Field label="Avisar quando saldo for menor que (R$)" name="limit" defaultValue={c.lowBalanceAlertCents != null ? (c.lowBalanceAlertCents / 100).toString() : ""} />
            <Field label="WhatsApp de destino" name="phone" defaultValue={c.alertPhone ?? ""} placeholder="5551999999999" />
            <Submit className="btn-primary">Salvar</Submit>
          </Form>
        </section>
      ))}
      {postpaid.map((c) => (
        <section key={c.id} className="card p-4 text-sm text-muted">
          {c.accountName ?? c.adAccountId}: conta pós-paga — sem alerta de saldo.
        </section>
      ))}
    </div>
  );
}
```

> Conferir os componentes `Form`, `Field`, `Submit` em `@/components/form` (já usados na página de Integrações) e a assinatura — `saveMeta` usa `Form action={saveMeta}`. Ajustar props (`label`, `name`, `defaultValue`) ao contrato real desses componentes.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add "src/server/actions/campaigns.ts" "src/app/(app)/campanhas/_tabs/alerta-saldo.tsx"
git commit -m "feat(trafego): aba Alerta de saldo (config do admin mestre)"
```

---

## Task 17: Backfill ad-level (opcional, histórico profundo)

**Files:**
- Modify: `app/src/lib/integrations/meta.ts` (estender `backfillMetaMonth`)
- Modify: `app/src/app/(app)/campanhas/backfill-button.tsx` (texto/aviso de que agora inclui anúncios — se aplicável)

- [ ] **Step 1: Adicionar coleta ad-level no backfill mensal**

Dentro de `backfillMetaMonth`, após o laço que grava `meta_insights_daily`, acrescentar uma segunda passagem `level=ad` com `time_range` igual, gravando em `meta_ad_insights_daily` (mesmo mapeamento da Task 4, Step 5, mas com `time_range` em vez de `date_preset`). Reutilizar `mapEngagement`.

```ts
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
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/lib/integrations/meta.ts" "src/app/(app)/campanhas/backfill-button.tsx"
git commit -m "feat(trafego): backfill ad-level no histórico mensal"
```

---

## Task 18: Verificação ponta a ponta

- [ ] **Step 1: Build completo**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS em tudo.

- [ ] **Step 2: Smoke manual (dev)**

Run: `set -a; . ./.env.local; set +a; npm run dev` e abrir `/campanhas`.
- Sem conta conectada: aparece o aviso para conectar.
- Com conta conectada + "Atualizar agora": abas Resumo/Campanhas/Criativos/WhatsApp populam; filtros de período/conta/campanha alteram os números; grão Campanhas/Conjuntos/Anúncios troca a tabela; export CSV baixa arquivo; Vínculos lista a conta com tipo/saldo; Alerta de saldo só edita como master.

- [ ] **Step 3: Checar critérios de aceite do spec**

Revisar os 8 critérios da seção "Critérios de aceite" do spec e marcar cada um.

- [ ] **Step 4: Commit final / abrir PR**

```bash
git push -u origin feat/trafego-pago-meta
gh pr create --title "Tráfego pago: painel de campanhas Meta" --body "Implementa o painel conforme docs/superpowers/specs/2026-11-18-trafego-pago-meta-design.md"
```

---

## Notas de verificação (nomes a confirmar durante a execução)

Antes/junto da primeira task que usa cada um, confirmar no código real e ajustar:
- `whatsapp_accounts`: colunas `phoneNumberId`, `accessTokenEnc`, `status` (Task 5).
- `appointments.status` — valor para "compareceram" (Task 11 usa `'completed'`; ajustar ao enum real).
- `deals.won_at`, `orders.status`/`total_cents`, `contacts.whatsapp`, `contacts.meta_ad_id` (já existem no schema lido).
- `@/components/form` (`Form`/`Field`/`Submit`) e `@/components/ui` (`StatCard` com `hint`, `Empty`, `PageHeader`).
- `@/lib/utils`: `money` (centavos), `fmtDateTime`, `todayISO`, `cn`.
- `ActionButton` e `BackfillButton` já existem e são reutilizados.
```
