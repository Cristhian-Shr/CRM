# Campanhas Meta — histórico, períodos, comparação e gráficos

**Data:** 2026-10-22
**Página alvo:** `/campanhas` (`app/src/app/(app)/campanhas/page.tsx`)

## Objetivo

Hoje a página Campanhas Meta mostra apenas os últimos 7/14/30 dias, sem histórico
de meses antigos, sem comparação e sem gráficos. Este trabalho adiciona:

1. **Importação de histórico** (~37 meses) da Meta, uma vez, com barra de progresso.
2. **Seletor de período flexível** (atalhos + intervalo "De/Até" por dia).
3. **Comparação período vs período anterior** (variação % nos cartões).
4. **Gráficos SVG leves** (evolução no tempo e campanha vs campanha).

## Contexto técnico relevante

- Deploy no **Vercel Hobby** (ver memória `crm-vercel-deploy`): funções têm limite de
  tempo curto (~10–60s) e **crons foram removidos**. Por isso a importação precisa ser
  fatiada em requisições curtas, acionadas pelo cliente.
- A sincronização atual (`app/src/lib/integrations/meta.ts` → `syncMetaConnection`) só
  puxa `date_preset: "last_7d"`. Os dados diários ficam em `meta_insights_daily`
  (`company_id`, `meta_campaign_id`, `date`, `spend_cents`, `impressions`, `reach`,
  `clicks`, `leads`, `messages_started`), com índice único
  `(company_id, meta_campaign_id, date)`.
- O componente `StatCard` (`app/src/components/ui.tsx`) **já aceita** a prop
  `delta?: number | null` e a renderiza colorida (verde ≥ 0, vermelho < 0). **Não
  precisa ser alterado** — basta calcular e passar o valor.
- O projeto **não tem** biblioteca de gráficos. Os gráficos serão SVG feitos à mão.
- A tabela de dados por campanha cruza com o CRM (leads, agendamentos, fechamentos,
  faturamento) — isso permanece na tabela, não vai para os gráficos diários.

## 1. Importação de histórico (backfill)

### Camada de dados — `app/src/lib/integrations/meta.ts`

Nova função exportada:

```
backfillMetaMonth(conn, year, month) → { rows: number }
```

- Monta `time_range={since: "YYYY-MM-01", until: "YYYY-MM-<últimoDia>"}` para o mês.
- Chama a Graph API de insights com `level: "campaign"`, `time_increment: "1"`,
  `fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,actions"`,
  paginando como o sync atual já faz.
- Para cada linha, **upsert** em `meta_insights_daily` reaproveitando exatamente o
  mesmo `onConflictDoUpdate` do sync atual.
- Se o `campaign_id` do insight **não existir** em `meta_campaigns`, grava um registro
  mínimo (id + `campaign_name` + `status: "ARCHIVED"`), para campanhas antigas/pausadas
  aparecerem no histórico mesmo fora da lista ativa. Usa o `onConflictDoNothing`/
  `onConflictDoUpdate` adequado para não sobrescrever campanhas já conhecidas.
- Retorna a quantidade de linhas processadas (`rows`).

Adicionar `campaign_name` aos `fields` de insights também no `syncMetaConnection` para
o mesmo benefício no fluxo normal.

`syncMetaConnection` (7 dias) permanece inalterada no restante.

### Server action — `app/src/server/actions/campaigns.ts`

```
backfillMetaMonth(monthsAgo: number) → { month: "YYYY-MM", rows: number, done: boolean }
```

- `assertCan(ctx, "campaigns.view")` como o `syncMetaNow`.
- Calcula o mês alvo = mês atual − `monthsAgo`.
- Para cada conexão da empresa, chama `backfillMetaMonth(conn, ano, mes)` e soma `rows`.
- `done = true` quando `monthsAgo >= 37`. Também sinaliza `rows` para o cliente decidir
  parar cedo (ver abaixo).
- `revalidatePath("/campanhas")` ao final.

### Cliente — `app/src/app/(app)/campanhas/backfill-button.tsx` (novo, client)

- Botão **"Importar histórico"**.
- Ao clicar, faz um loop de `monthsAgo = 0 … 36`, chamando a action a cada iteração
  (sequencial), atualizando uma barra/texto de progresso: "Importando… mês X de 37".
- **Parada antecipada:** se vierem **2 meses consecutivos com `rows === 0`**, assume que
  a conta não existia tão atrás e encerra.
- Em erro, para e mostra a mensagem; o que já importou fica salvo.
- Ao concluir, `router.refresh()` para recarregar os dados.

## 2. Seletor de período — `app/src/app/(app)/campanhas/period-picker.tsx` (novo, client)

Substitui os botões `7/14/30 dias` atuais. Contém:

- **Atalhos:** Hoje · Ontem · 7 dias · 30 dias · Este mês · Mês passado.
- **Campos "De" e "Até":** dois `<input type="date">` nativos para qualquer intervalo.
- Cada escolha navega para a URL com `?de=YYYY-MM-DD&ate=YYYY-MM-DD` (mantendo `&todas=1`
  quando ativo). Os atalhos apenas calculam e setam `de`/`ate`.

### Lógica de período na página (`page.tsx`)

- Lê `sp.de` / `sp.ate`. Default (ausente): últimos 7 dias (`ate = hoje`, `de = hoje−6`).
- Valida formato `YYYY-MM-DD`; se inválido, cai no default.
- Mantém o toggle **"Ver todas / Só ativas"** (`sp.todas`) e remove o cap de exibição —
  a tabela lista **todas** as campanhas do período (a query já não tem LIMIT).

## 3. Comparação período vs anterior

- Período anterior = janela imediatamente anterior, de **mesmo tamanho em dias**,
  terminando no dia anterior a `de`. Ex.: período de 10 dias → anterior são os 10 dias
  que terminam em `de − 1`.
- A query de totais (a atual `tot`) roda **duas vezes** (período atual e anterior), ou
  numa única query com dois `sum(... filter where date between ...)`.
- Para cada cartão (Investimento, Impressões, Cliques, Leads) calcula
  `delta = round((atual − anterior) / anterior * 100)` (null se anterior = 0) e passa em
  `<StatCard delta={...} />`. Nenhuma mudança no componente.

## 4. Gráficos SVG — `app/src/app/(app)/campanhas/charts.tsx` (novo, client)

Componente SVG reutilizável (sem dependência): eixo, linha/área e tooltip no hover.

### 4a. Evolução no tempo

- Seletor de métrica: **Investimento · Leads · CPL · Cliques**.
- Dados vindos de `meta_insights_daily` agregados por data:
  - **dia a dia** quando o período ≤ ~60 dias;
  - **mês a mês** (`date_trunc('month')`) em períodos longos.
- Uma série (a métrica escolhida) no intervalo selecionado.

### 4b. Campanha vs campanha

- Múltiplas linhas coloridas, uma por campanha, da mesma métrica no tempo.
- **Chips** para ligar/desligar campanhas. Começa com as **5 de maior investimento** no
  período ativas por padrão.
- Dados: uma query retornando `(date, meta_campaign_id, <métrica>)` agregada no mesmo
  bucket (dia/mês) do item 4a.

### Fonte de dados dos gráficos (page.tsx, server)

- Nova query de série temporal geral (4a) e por campanha (4b), respeitando `de`/`ate` e o
  bucket (dia vs mês). Passadas como props (arrays simples) aos componentes client.

### Escopo (YAGNI)

- **Faturamento e ROAS** ficam **apenas** na tabela e nos cartões (com variação %),
  **não** entram nos gráficos diários — vêm do CRM (orders/contacts) e misturar no bucket
  diário dobraria a complexidade. Pode ser adicionado depois se necessário.

## Arquivos

| Arquivo | Mudança |
|---|---|
| `app/src/lib/integrations/meta.ts` | nova `backfillMetaMonth`; `campaign_name` nos fields |
| `app/src/server/actions/campaigns.ts` | nova action `backfillMetaMonth(monthsAgo)` |
| `app/src/app/(app)/campanhas/page.tsx` | período `de/ate`, comparação, queries de série, render dos novos componentes |
| `app/src/app/(app)/campanhas/backfill-button.tsx` | **novo** (client) progresso de importação |
| `app/src/app/(app)/campanhas/period-picker.tsx` | **novo** (client) atalhos + De/Até |
| `app/src/app/(app)/campanhas/charts.tsx` | **novo** (client) gráficos SVG |

`ui.tsx` **não** muda (StatCard já suporta `delta`).

## Riscos / pontos de atenção

- **Timeout Vercel:** mitigado fatiando o backfill por mês (requisições curtas).
- **Rate limit da Meta:** o loop é sequencial (1 mês por vez); se aparecer erro de limite,
  o botão para e o usuário pode continuar depois (os meses já importados ficam salvos).
- **Volume de dados:** ~37 meses × dezenas de campanhas ≈ dezenas de milhares de linhas
  por empresa — tranquilo para Postgres/Neon com o índice único existente.
- **Campanhas arquivadas:** cobertas pelo registro mínimo via `campaign_name` do insight.
```