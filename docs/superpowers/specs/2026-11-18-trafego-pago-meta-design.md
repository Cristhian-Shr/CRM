# Tráfego Pago (Meta Ads) — Painel de Campanhas

**Data:** 2026-11-18
**Status:** Aprovado para implementação
**Rota:** `/campanhas` (rótulo sidebar: "Campanhas Meta"; cabeçalho da página: "Tráfego pago")

## Objetivo

Transformar a tela **Campanhas Meta** (hoje apenas um aviso "Conecte a conta…") num
painel completo de tráfego pago que cruza os números da Meta Ads (somente leitura)
com leads, agendamentos e vendas do CRM, no padrão do Gerenciador de Anúncios, com:

- Filtros de período, conta e campanha.
- Abas: **Resumo**, **Campanhas**, **Anúncios e criativos**, **WhatsApp**, **Vínculos**, **Alerta de saldo**.
- Coleta expandida: conjuntos (adsets), anúncios (ads), criativos (thumbnails),
  métricas de engajamento e saldo/funding da conta.
- Alerta de saldo baixo por WhatsApp para contas pré-pagas (boleto/pix).

**Fora de escopo:** aba Instagram (ManyChat) — o usuário não usa ManyChat.

## Contexto atual (o que já existe)

- `meta_connections` — uma linha por conta de anúncio; token criptografado (`accessTokenEnc`), `pageId`, `lastSyncAt`, `lastError`, `status`.
- `meta_campaigns` — campanhas (nome, objetivo, status, budgets, start/stop).
- `meta_insights_daily` — insights **nível campanha** por dia: `spendCents, impressions, reach, clicks, leads, messagesStarted`. Chave única `(companyId, metaCampaignId, date)`.
- `contacts` — já guarda `metaLeadId, metaCampaignId, metaAdsetId, metaAdId` (atribuição pronta para cruzamento em todos os grãos).
- `src/lib/integrations/meta.ts` — `syncMetaConnection` (campanhas + insights last_7d), `backfillMetaMonth` (histórico mês a mês, até 37 meses), `fetchLead`.
- `src/app/api/cron/meta-sync/route.ts` — cron (mas crons do Vercel foram removidos no plano Hobby; sync hoje depende de "Atualizar agora" e do webhook de leads).
- `src/app/(app)/campanhas/page.tsx` — tela atual: StatCards + uma tabela campanha×CRM (Investido, Cliques, Leads Meta, CPL, Leads CRM, Agendaram, Fecharam, Faturamento, ROAS). Botões: período (7/14/30), "Ver todas", "Importar histórico" (`BackfillButton`), "Atualizar agora".
- `src/app/(app)/configuracoes/integracoes/page.tsx` + `saveMeta` em `settings.ts` — conexão da conta.
- `src/lib/integrations/whatsapp.ts` — `sendText(phoneNumberId, token, to, body)` para disparar WhatsApp.
- Utils: `money()`, `fmtDateTime()`, `todayISO()`. Permissão `campaigns.view` já existe. `ctx.isMaster` identifica o admin mestre.
- **Sem biblioteca de gráfico** no projeto → gráficos via SVG próprio, sem nova dependência.
- Padrão de filtros: client component que faz `router.push` com searchParams; página server lê searchParams e consulta (ver `relatorios/report-filters.tsx`).
- Server actions usam o wrapper `safe()`.

## Decisão de arquitetura: grão dos insights

Guardar insights **no nível de anúncio** (`meta_ad_insights_daily`) e fazer rollup
por `SUM` para conjunto e campanha. Mantém-se a `meta_insights_daily` (nível campanha)
existente para o Resumo e para o histórico profundo já coletado.

- **Impressões, cliques, gasto, leads, engajamento:** somáveis — rollup por `SUM` é correto.
- **Alcance (reach):** NÃO é somável (dedup da Meta). Para o grão de campanha usa-se o
  `reach` já coletado em `meta_insights_daily`; para conjunto/anúncio exibe-se o reach
  do próprio grão (da `meta_ad_insights_daily`), rotulado como aproximado quando agregado.
- **Alternativa descartada:** coletar insights em cada grão separadamente (3× chamadas)
  — mais preciso para reach, porém 3× o custo de API e de linhas; não compensa para um painel.

## Modelo de dados (migrations Drizzle)

Novas tabelas e campos (seguindo os helpers do schema: `id()`, `companyRef()`, `ts()`, `date()`, `integer()`, `text()`, `uniqueIndex`):

### `meta_adsets`
```
id, companyId, connectionId → meta_connections.id,
metaAdsetId (text, unique com companyId), metaCampaignId (text),
name, status, dailyBudgetCents, lifetimeBudgetCents, updatedAt
uniqueIndex (companyId, metaAdsetId)
```

### `meta_ads`
```
id, companyId, connectionId,
metaAdId (text), metaAdsetId (text), metaCampaignId (text),
name, status,
creativeId (text), thumbnailUrl (text), title (text), body (text), permalink (text),
effectiveInstagramId (text) | pageName (text)  // para "Canal" da aba WhatsApp
updatedAt
uniqueIndex (companyId, metaAdId)
```

### `meta_ad_insights_daily`
```
id, companyId, metaAdId (text), metaAdsetId (text), metaCampaignId (text), date,
spendCents, impressions, reach, clicks, linkClicks,
leads, messagesStarted,
reactions, comments, shares, saves, videoViews, postEngagement
uniqueIndex (companyId, metaAdId, date)
índice auxiliar (companyId, date) e (companyId, metaCampaignId, date)
```

### `meta_connections` — campos novos
```
accountName (text), currency (text, default 'BRL'), accountStatus (text),
fundingType (text: 'prepaid' | 'postpaid' | null), balanceCents (integer), spendCapCents (integer),
pageName (text),
-- config de alerta (admin mestre):
lowBalanceAlertCents (integer), alertPhone (text), alertEnabled (boolean default false),
lastBalanceAlertAt (ts)
```

## Coleta (expandir `src/lib/integrations/meta.ts`)

### `syncMetaConnection` passa a também:

1. **Info da conta** — `GET {adAccountId}?fields=name,currency,account_status,balance,spend_cap,amount_spent,funding_source_details`.
   - `fundingType`: `prepaid` se `funding_source_details.type` indicar pré-pago (ex. boleto/pix/`DIGITAL_WALLET`/prepaid), senão `postpaid`.
   - `balanceCents`, `spendCapCents`, `accountName`, `currency`, `accountStatus` → `meta_connections`.
   - `pageName` via `GET {pageId}?fields=name` quando houver `pageId`.
2. **Adsets** — `GET {adAccountId}/adsets?fields=id,name,status,campaign_id,daily_budget,lifetime_budget` → upsert `meta_adsets`.
3. **Ads + creative** — `GET {adAccountId}/ads?fields=id,name,status,adset_id,campaign_id,creative{id,thumbnail_url,title,body,effective_instagram_media_id,effective_object_story_id}` → upsert `meta_ads` (guarda `thumbnailUrl`, `title`, `body`, `permalink`).
4. **Insights nível anúncio (últimos 30 dias)** — `GET {adAccountId}/insights?level=ad&time_increment=1&date_preset=last_30d&fields=ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,inline_link_clicks,actions,video_30_sec_watched_actions` → upsert `meta_ad_insights_daily`.
   - Mapear `actions[].action_type`:
     - leads: `lead`, `onsite_conversion.lead_grouped`, `offsite_conversion.fb_pixel_lead` (usar o maior, como hoje).
     - messagesStarted: `onsite_conversion.messaging_conversation_started_7d`.
     - linkClicks: `link_click` (ou campo `inline_link_clicks`).
     - reactions: `post_reaction`; comments: `comment`; shares: `post`; saves: `onsite_conversion.post_save`; postEngagement: `post_engagement`.
     - videoViews: `video_view` (ou `video_30_sec_watched_actions`).
5. **Verificação de saldo** (ver "Alerta de saldo").
6. Mantém o sync nível campanha atual (`meta_insights_daily`) para o Resumo/histórico.

### `backfillMetaMonth`
- Ganha a opção de puxar **ad-level** mês a mês (`level=ad`, `time_range`), gravando em `meta_ad_insights_daily`. Mais pesado — a UI avisa. O backfill campanha-level atual permanece.

### Permissões Meta
Tudo sob `ads_read` (Marketing API) — já é a conexão existente. Nenhum escopo novo além do que a conta de anúncios já concede.

## Página `/campanhas` — "Tráfego pago"

Server component lê `searchParams`: `aba`, `periodo` (preset), `de`, `ate`, `conta` (connectionId | "all"), `campanha` (metaCampaignId | "all"), e específicos de aba (`grao`, `comparar`, `detalhar`, `ordenar`).

### Cabeçalho
`PageHeader` título "Tráfego pago", subtítulo "Meta Ads (somente leitura) cruzado com leads, agendamentos e vendas do CRM. Última coleta há X" + botão **Atualizar agora** (`syncMetaNow`). Reaproveita `BackfillButton`.

### Barra de filtros (client component `trafego-filters.tsx`)
Período (presets: Hoje, 7/14/30 dias, Este mês, Personalizado), De, Até, **Conta** (lista de `meta_connections`), **Campanha** (lista de `meta_campaigns` da conta). `router.push` com searchParams, como em `relatorios`.

### Abas (navegação por `?aba=`)
Cada aba é renderizada no server a partir dos filtros.

1. **Resumo**
   - StatCards: Investido, Leads (Meta), Custo por lead (CPL = gasto/leads), CTR (cliques/impressões), CPM (gasto/impressões×1000).
   - Gráfico SVG combo **Investido × leads por dia** (barras = investido, linha = leads). Componente novo `components/charts/bar-line.tsx` (sem dependência).

2. **Campanhas**
   - (a) **Resultado real no CRM** — tabela: Campanha · Investido · Leads Meta · Conversaram · Compareceram · Compraram · Vendido · Custo/lead real · ROI. Cruza `contacts` (por `meta_campaign_id`), `appointments`, `deals` (won), `orders` (confirmed/paid). Botão "Colunas" (mostrar/ocultar).
   - (b) **Explore como no Gerenciador** — tabela detalhada com:
     - Toggle de grão **Campanhas / Conjuntos / Anúncios** (`?grao=`), lendo de `meta_ad_insights_daily` (rollup por SUM conforme o grão).
     - Colunas: Status, Investido, Impressões, Alcance, Cliques, CTR, CPM, Reações, Coment., Compart., Salvos, Vídeo, Engaj., Cliques no link, Lead Meta, CPL.
     - **Comparar com período anterior** (`?comparar=1`) → calcula o período equivalente anterior e exibe deltas.
     - **Detalhar por** Dia/Semana/Mês (`?detalhar=`).
     - **Exportar CSV** (Excel) — server action que devolve CSV do grão/período atuais.

3. **Anúncios e criativos**
   - Grid de cards: thumbnail (`thumbnailUrl`), nome do anúncio, campanha, badge de status, métricas (Investido, CTR, CPM, Leads, CPL). Filtros: Campanha + Ordenar por (Investido, Leads, CPL, CTR).

4. **WhatsApp**
   - Tabela: Anúncio · Canal (página/Instagram do criativo) · Conversas WhatsApp (`messagesStarted`) · Investido · Custo/conversa · Leads CRM (contacts via WhatsApp atribuídos ao anúncio). Ordena por conversas.

5. **Vínculos**
   - Gerencia contas/páginas Meta conectadas: lista `meta_connections` com nome, moeda, tipo de conta (pré/pós), saldo, última sync, status/erro. Ações: adicionar conexão (token + conta + página), definir `pageId`, remover. Reutiliza/estende `saveMeta`.

6. **Alerta de saldo**
   - Visível para todos; edição **somente `isMaster`** (não-master vê "Somente o admin mestre configura o alerta de saldo.").
   - Por conta **pré-paga**: limite (R$), WhatsApp de destino, liga/desliga. Conta pós-paga aparece como "sem alerta (pós-pago)".
   - Server action `saveBalanceAlert` grava `lowBalanceAlertCents`, `alertPhone`, `alertEnabled` em `meta_connections` (assert `isMaster`).

## Alerta de saldo (sem cron)

Dentro de `syncMetaConnection`, após atualizar `balanceCents`:
- Se `fundingType === 'prepaid'` **e** `alertEnabled` **e** `balanceCents < lowBalanceAlertCents`
  **e** passou o cooldown (`lastBalanceAlertAt` há mais de 12h):
  - Envia `sendText` pela conta WhatsApp da empresa (`whatsapp_accounts`) para `alertPhone`,
    com mensagem do tipo "Saldo da conta {accountName} está em R$ X (limite R$ Y). Recarregue para não pausar os anúncios."
  - Atualiza `lastBalanceAlertAt`.
- Dispara tanto no "Atualizar agora" quanto em qualquer sync — não depende de cron.

## Permissões / escopo

- Abas de visão: `campaigns.view` (redireciona para `/dashboard` se não puder).
- Edição do Alerta de saldo: `ctx.isMaster`.
- Sem ManyChat/Instagram.

## Pontos assumidos

- **"Canal"** (aba WhatsApp) derivado do creative do anúncio (página/Instagram); refinável na implementação.
- **Thumbnails** da Meta expiram — guarda-se a URL e atualiza a cada sync (sem cache em storage por ora).
- Sidebar permanece "Campanhas Meta"; só o cabeçalho vira "Tráfego pago".
- Reach agregado em conjunto/anúncio é aproximado (soma), com rótulo.

## Critérios de aceite

1. Conectada uma conta com `ads_read`, "Atualizar agora" popula adsets, ads, criativos e `meta_ad_insights_daily`.
2. Resumo mostra Investido/Leads/CPL/CTR/CPM e o gráfico Investido×leads por dia do período filtrado.
3. Campanhas: tabela CRM e tabela Gerenciador com os 3 grãos, comparação de período, detalhamento e export CSV.
4. Anúncios e criativos mostra cards com thumbnail e métricas, com filtro e ordenação.
5. WhatsApp mostra conversas, custo/conversa e leads CRM por anúncio.
6. Vínculos permite ver/gerenciar contas e páginas; mostra tipo de conta e saldo.
7. Alerta de saldo: só master edita; conta pré-paga abaixo do limite dispara WhatsApp (respeitando cooldown).
8. Filtros de período/conta/campanha afetam todas as abas.
