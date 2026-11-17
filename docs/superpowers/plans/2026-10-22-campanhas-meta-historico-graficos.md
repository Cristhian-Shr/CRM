# Campanhas Meta — histórico, períodos, comparação e gráficos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à página `/campanhas` importação de histórico (~37 meses), seletor de período por intervalo de dias, comparação com o período anterior e gráficos SVG.

**Architecture:** O backfill é fatiado em uma requisição por mês (contornando o timeout do Vercel Hobby), acionado por um botão-cliente que faz loop com barra de progresso. O período vira `?de=&ate=` na URL; a página server-side recalcula totais, totais do período anterior (para variação %) e séries temporais, passando arrays simples para componentes client que desenham SVG.

**Tech Stack:** Next.js (App Router, Server Components + Server Actions), Drizzle ORM (`db.execute(sql\`...\`)`), Postgres/Neon, SVG puro (sem biblioteca de gráficos).

> **Nota sobre verificação:** este projeto **não tem testes automatizados** (sem vitest/jest). Cada tarefa é verificada com `npm run typecheck`, `npm run lint` e conferência manual no `npm run dev`. Todos os comandos rodam dentro de `app/`.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `app/src/lib/integrations/meta.ts` | **Modificar** — nova função `backfillMetaMonth` (puxa 1 mês de insights e grava) |
| `app/src/server/actions/campaigns.ts` | **Modificar** — nova action `backfillMetaMonth(monthsAgo)` com tipo de retorno próprio |
| `app/src/app/(app)/campanhas/backfill-button.tsx` | **Criar** — botão client com barra de progresso |
| `app/src/app/(app)/campanhas/period-picker.tsx` | **Criar** — atalhos + campos De/Até |
| `app/src/app/(app)/campanhas/charts.tsx` | **Criar** — gráficos SVG (evolução + campanha vs campanha) |
| `app/src/app/(app)/campanhas/page.tsx` | **Modificar** — período de/ate, comparação, séries, render dos novos componentes |

`app/src/components/ui.tsx` **não muda** — `StatCard` já aceita `delta?: number | null`.

---

## Task 1: Backfill na camada de dados (`meta.ts`)

**Files:**
- Modify: `app/src/lib/integrations/meta.ts`

- [ ] **Step 1: Adicionar `campaign_name` ao type `Insight`**

Em `app/src/lib/integrations/meta.ts`, localize o `type Insight = { ... }` (por volta da linha 29) e adicione o campo `campaign_name`:

```ts
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
```

- [ ] **Step 2: Adicionar a função `backfillMetaMonth`**

No fim de `app/src/lib/integrations/meta.ts`, **antes** da função `fetchLead`, adicione:

```ts
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
```

- [ ] **Step 3: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/integrations/meta.ts
git commit -m "feat(meta): função backfillMetaMonth para importar histórico por mês"
```

---

## Task 2: Server Action de backfill (`campaigns.ts`)

**Files:**
- Modify: `app/src/server/actions/campaigns.ts`

- [ ] **Step 1: Importar a função de lib com alias**

Em `app/src/server/actions/campaigns.ts`, altere o import de integrations/meta para incluir a nova função com alias (evita colisão com a action de mesmo nome):

```ts
import { backfillMetaMonth as backfillMetaMonthLib, syncMetaConnection } from "@/lib/integrations/meta";
```

- [ ] **Step 2: Adicionar a action `backfillMetaMonth`**

No fim de `app/src/server/actions/campaigns.ts`, adicione:

```ts
/**
 * Importa o histórico de UM mês (monthsAgo = 0 é o mês atual, 1 o anterior, ...).
 * Tem retorno próprio (não usa safe()) para o cliente ler rows/done e exibir progresso.
 */
export async function backfillMetaMonth(
  monthsAgo: number,
): Promise<{ month: string; rows: number; done: boolean; error?: string }> {
  try {
    const ctx = await getContext();
    assertCan(ctx, "campaigns.view");
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
    const year = target.getUTCFullYear();
    const month = target.getUTCMonth() + 1;
    const conns = await db.select().from(schema.metaConnections).where(eq(schema.metaConnections.companyId, ctx.companyId));
    let rows = 0;
    for (const c of conns) rows += (await backfillMetaMonthLib(c, year, month)).rows;
    const done = monthsAgo >= 37;
    if (done) revalidatePath("/campanhas");
    return { month: `${year}-${String(month).padStart(2, "0")}`, rows, done };
  } catch (e) {
    return { month: "", rows: 0, done: true, error: e instanceof Error ? e.message : "Erro ao importar o histórico." };
  }
}
```

- [ ] **Step 3: Verificar tipos e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/src/server/actions/campaigns.ts
git commit -m "feat(campanhas): action backfillMetaMonth com progresso por mês"
```

---

## Task 3: Botão de importar com progresso (`backfill-button.tsx`) + wiring

**Files:**
- Create: `app/src/app/(app)/campanhas/backfill-button.tsx`
- Modify: `app/src/app/(app)/campanhas/page.tsx` (apenas import + render do botão nas actions)

- [ ] **Step 1: Criar o componente client**

Crie `app/src/app/(app)/campanhas/backfill-button.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { backfillMetaMonth } from "@/server/actions/campaigns";

const MAX_MONTHS = 37;

/** Importa o histórico mês a mês, mostrando progresso. Para após 2 meses vazios seguidos. */
export function BackfillButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    let empty = 0;
    try {
      for (let m = 0; m <= MAX_MONTHS; m++) {
        setProgress(`Importando… mês ${m + 1} de ${MAX_MONTHS + 1}`);
        const r = await backfillMetaMonth(m);
        if (r.error) {
          setError(r.error);
          break;
        }
        if (r.rows === 0) {
          empty++;
          if (empty >= 2) break;
        } else {
          empty = 0;
        }
        if (r.done) break;
      }
    } finally {
      setRunning(false);
      setProgress(null);
      router.refresh();
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" className="btn-secondary" disabled={running} onClick={run}>
        {running ? (progress ?? "Importando…") : "Importar histórico"}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-red-600">{error}</span>}
    </span>
  );
}
```

- [ ] **Step 2: Importar o botão na página**

Em `app/src/app/(app)/campanhas/page.tsx`, adicione o import (junto aos demais imports de componentes locais):

```ts
import { BackfillButton } from "./backfill-button";
```

- [ ] **Step 3: Renderizar o botão nas actions do PageHeader**

Em `page.tsx`, dentro de `actions={<> ... </>}` do `PageHeader`, adicione `<BackfillButton />` logo antes do `<ActionButton action={syncMetaNow} ...>`:

```tsx
            <Link href={sp.todas ? `?dias=${days}` : `?dias=${days}&todas=1`} className="btn-secondary">
              {sp.todas ? "Só ativas" : "Ver todas"}
            </Link>
            <BackfillButton />
            <ActionButton action={syncMetaNow} className="btn-primary">
              Atualizar agora
            </ActionButton>
```

> Observação: este `Link` com `?dias=` será substituído na Task 4; aqui só inserimos o botão.

- [ ] **Step 4: Verificar tipos/lint e testar manualmente**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.
Manual: `npm run dev`, abrir `/campanhas`, clicar em **Importar histórico** e confirmar a troca do texto do botão para "Importando… mês X de 38" e, ao final, o recarregamento da página.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/\(app\)/campanhas/backfill-button.tsx app/src/app/\(app\)/campanhas/page.tsx
git commit -m "feat(campanhas): botão Importar histórico com barra de progresso"
```

---

## Task 4: Seletor de período De/Até (`period-picker.tsx`) + lógica na página

**Files:**
- Create: `app/src/app/(app)/campanhas/period-picker.tsx`
- Modify: `app/src/app/(app)/campanhas/page.tsx`

- [ ] **Step 1: Criar o seletor de período**

Crie `app/src/app/(app)/campanhas/period-picker.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";

/** Data local (sem drift de fuso) no formato AAAA-MM-DD. */
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function PeriodPicker({ de, ate }: { de: string; ate: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const todas = sp.get("todas") ? "&todas=1" : "";
  const go = (d: string, a: string) => router.push(`?de=${d}&ate=${a}${todas}`);

  const presets: [string, () => void][] = [
    ["Hoje", () => { const t = new Date(); go(iso(t), iso(t)); }],
    ["Ontem", () => { const y = addDays(new Date(), -1); go(iso(y), iso(y)); }],
    ["7 dias", () => { const t = new Date(); go(iso(addDays(t, -6)), iso(t)); }],
    ["30 dias", () => { const t = new Date(); go(iso(addDays(t, -29)), iso(t)); }],
    ["Este mês", () => { const t = new Date(); go(iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)); }],
    ["Mês passado", () => {
      const t = new Date();
      go(iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0)));
    }],
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-xl border border-line text-sm">
        {presets.map(([label, fn]) => (
          <button key={label} type="button" onClick={fn} className="px-3 py-1.5 text-muted transition-colors hover:bg-brand-50">
            {label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-sm text-muted">
        De
        <input type="date" value={de} max={ate} onChange={(e) => e.target.value && go(e.target.value, ate)} className="input w-36" />
      </label>
      <label className="flex items-center gap-1 text-sm text-muted">
        Até
        <input type="date" value={ate} min={de} onChange={(e) => e.target.value && go(de, e.target.value)} className="input w-36" />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Trocar o parsing de período na página**

Em `app/src/app/(app)/campanhas/page.tsx`, substitua a assinatura de `searchParams` e o bloco de cálculo de `days`/`since`.

Troque:

```ts
const PERIODS: Record<string, number> = { "7": 7, "14": 14, "30": 30 };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ dias?: string; todas?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, "campaigns.view")) redirect("/dashboard");
  const sp = await searchParams;
  const days = PERIODS[sp.dias ?? "7"] ?? 7;
  const since = todayISO(undefined, new Date(Date.now() - (days - 1) * 86_400_000));
```

Por:

```ts
const DAY_MS = 86_400_000;
const validDate = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; todas?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, "campaigns.view")) redirect("/dashboard");
  const sp = await searchParams;
  const ate = validDate(sp.ate) ?? todayISO();
  const de = validDate(sp.de) ?? todayISO(undefined, new Date(Date.now() - 6 * DAY_MS));
  const len = Math.max(1, Math.round((Date.parse(ate) - Date.parse(de)) / DAY_MS) + 1);
  const prevAte = todayISO(undefined, new Date(Date.parse(de) - DAY_MS));
  const prevDe = todayISO(undefined, new Date(Date.parse(de) - DAY_MS * len));
```

- [ ] **Step 3: Usar `de`/`ate` na query principal**

Na query `rows` (o `db.execute(sql\`...\`)` grande), troque a condição de data do `left join`:

De:

```ts
    left join meta_insights_daily i on i.company_id = c.company_id and i.meta_campaign_id = c.meta_campaign_id and i.date >= ${since}
```

Para:

```ts
    left join meta_insights_daily i on i.company_id = c.company_id and i.meta_campaign_id = c.meta_campaign_id and i.date between ${de} and ${ate}
```

- [ ] **Step 4: Substituir o seletor 7/14/30 pelo PeriodPicker**

Adicione o import em `page.tsx`:

```ts
import { PeriodPicker } from "./period-picker";
```

No `actions={<> ... </>}` do `PageHeader`, troque o bloco do seletor antigo e o Link de "Ver todas":

De:

```tsx
            <div className="flex rounded-xl border border-line bg-surface p-1">
              {Object.keys(PERIODS).map((k) => (
                <Link key={k} href={`?dias=${k}${sp.todas ? "&todas=1" : ""}`} className={cn("rounded-lg px-3 py-1 text-sm", String(days) === k ? "bg-brand-500 text-white" : "text-muted")}>
                  {k} dias
                </Link>
              ))}
            </div>
            <Link href={sp.todas ? `?dias=${days}` : `?dias=${days}&todas=1`} className="btn-secondary">
              {sp.todas ? "Só ativas" : "Ver todas"}
            </Link>
```

Para:

```tsx
            <PeriodPicker de={de} ate={ate} />
            <Link href={sp.todas ? `?de=${de}&ate=${ate}` : `?de=${de}&ate=${ate}&todas=1`} className="btn-secondary">
              {sp.todas ? "Só ativas" : "Ver todas"}
            </Link>
```

- [ ] **Step 5: Ajustar o subtítulo do PageHeader**

Troque o `subtitle` do `PageHeader`:

De:

```tsx
        subtitle={`Últimos ${days} dias · ${lastSync ? `atualizado em ${fmtDateTime(lastSync)}` : "ainda não sincronizado"}`}
```

Para:

```tsx
        subtitle={`${de} a ${ate} · ${lastSync ? `atualizado em ${fmtDateTime(lastSync)}` : "ainda não sincronizado"}`}
```

- [ ] **Step 6: Remover o import `cn` se ficar sem uso**

Após as trocas, se `cn` não for mais usado em `page.tsx`, remova-o do import `@/lib/utils`. Rodar o lint acusa se sobrar import sem uso.

Run: `npm run typecheck && npm run lint`
Expected: sem erros (corrija import órfão se o lint apontar).
Manual: `/campanhas` — testar atalhos e os campos De/Até; a URL deve virar `?de=...&ate=...` e a tabela refletir o período.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/\(app\)/campanhas/period-picker.tsx app/src/app/\(app\)/campanhas/page.tsx
git commit -m "feat(campanhas): seletor de período com atalhos e intervalo De/Até"
```

---

## Task 5: Comparação com o período anterior (variação % nos cartões)

**Files:**
- Modify: `app/src/app/(app)/campanhas/page.tsx`

- [ ] **Step 1: Consultar os totais do período anterior**

Em `page.tsx`, logo após o cálculo de `tot` (o `list.reduce(...)`), adicione a query do período anterior e os deltas:

```ts
  const prevRes = await db.execute(sql`
    select
      coalesce(sum(i.spend_cents),0)::bigint as spend,
      coalesce(sum(i.impressions),0)::bigint as impressions,
      coalesce(sum(i.clicks),0)::bigint as clicks,
      (coalesce(sum(i.leads),0) + coalesce(sum(i.messages_started),0))::bigint as leads
    from meta_insights_daily i
    join meta_campaigns c on c.company_id = i.company_id and c.meta_campaign_id = i.meta_campaign_id
    where i.company_id = ${ctx.companyId} and i.date between ${prevDe} and ${prevAte}
    ${sp.todas ? sql`` : sql`and c.status = 'ACTIVE'`}
  `);
  const prev = prevRes.rows[0] as Record<string, unknown>;
  const pct = (cur: number, old: number) => (old > 0 ? Math.round(((cur - old) / old) * 100) : null);
  const delta = {
    spend: pct(tot.spend, Number(prev.spend)),
    impressions: pct(tot.impressions, Number(prev.impressions)),
    clicks: pct(tot.clicks, Number(prev.clicks)),
    leads: pct(tot.leads, Number(prev.leads)),
  };
```

- [ ] **Step 2: Passar `delta` para os StatCards**

Troque o grid de StatCards:

De:

```tsx
        <StatCard label="Investimento" value={money(tot.spend)} icon={DollarSign} />
        <StatCard label="Impressões" value={nf.format(tot.impressions)} icon={Eye} />
        <StatCard label="Cliques" value={nf.format(tot.clicks)} icon={MousePointerClick} />
        <StatCard label="Leads (Meta)" value={nf.format(tot.leads)} icon={UserPlus} hint={tot.leads ? `CPL ${money(Math.round(tot.spend / tot.leads))}` : undefined} />
```

Para:

```tsx
        <StatCard label="Investimento" value={money(tot.spend)} icon={DollarSign} delta={delta.spend} />
        <StatCard label="Impressões" value={nf.format(tot.impressions)} icon={Eye} delta={delta.impressions} />
        <StatCard label="Cliques" value={nf.format(tot.clicks)} icon={MousePointerClick} delta={delta.clicks} />
        <StatCard label="Leads (Meta)" value={nf.format(tot.leads)} icon={UserPlus} delta={delta.leads} hint={tot.leads ? `CPL ${money(Math.round(tot.spend / tot.leads))}` : undefined} />
```

- [ ] **Step 3: Verificar tipos/lint e conferir**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.
Manual: nos cartões deve aparecer `+X%` (verde) ou `-X%` (vermelho) ao lado das dicas; trocar o período muda os valores.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/\(app\)/campanhas/page.tsx
git commit -m "feat(campanhas): variação % vs período anterior nos cartões"
```

---

## Task 6: Gráficos SVG (`charts.tsx`) + séries na página

**Files:**
- Create: `app/src/app/(app)/campanhas/charts.tsx`
- Modify: `app/src/app/(app)/campanhas/page.tsx`

- [ ] **Step 1: Criar o componente de gráficos**

Crie `app/src/app/(app)/campanhas/charts.tsx`:

```tsx
"use client";

import { useState } from "react";
import { money } from "@/lib/utils";

type Point = { d: string; spend: number; leads: number; clicks: number };
type CampPoint = Point & { cid: string };
type Metric = "spend" | "leads" | "cpl" | "clicks";

const nf = new Intl.NumberFormat("pt-BR");
const COLORS = ["#be5574", "#6366f1", "#0ea5e9", "#22c55e", "#f59e0b"];

const METRICS: Record<Metric, { label: string; fmt: (v: number) => string }> = {
  spend: { label: "Investimento", fmt: (v) => money(v) },
  leads: { label: "Leads", fmt: (v) => nf.format(v) },
  cpl: { label: "CPL", fmt: (v) => money(Math.round(v)) },
  clicks: { label: "Cliques", fmt: (v) => nf.format(v) },
};

/** Valor da métrica para um ponto (CPL = investimento ÷ leads; null quando não há leads). */
function metricValue(p: Point, m: Metric): number | null {
  if (m === "cpl") return p.leads > 0 ? p.spend / p.leads : null;
  return p[m];
}

/** Rótulo do eixo X: "out/25" no modo mensal, "22/10" no diário. */
function label(d: string, monthly: boolean) {
  const [y, mo, day] = d.split("-");
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return monthly ? `${meses[Number(mo) - 1]}/${y.slice(2)}` : `${day}/${mo}`;
}

function LineChart({
  series,
  labels,
  fmt,
  height = 180,
}: {
  series: { color: string; values: (number | null)[] }[];
  labels: string[];
  fmt: (v: number) => string;
  height?: number;
}) {
  const W = 680;
  const padL = 52;
  const padR = 12;
  const padT = 10;
  const padB = 22;
  const n = labels.length;
  const nums = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const max = Math.max(1, ...nums);
  const x = (i: number) => padL + (n <= 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
  const y = (v: number) => padT + (height - padT - padB) * (1 - v / max);
  const ticks = [0, max / 2, max];
  // mostra no máximo 6 rótulos no eixo X
  const step = Math.max(1, Math.ceil(n / 6));

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-line" strokeWidth={1} />
          <text x={0} y={y(t) + 4} className="fill-muted text-[10px]">
            {fmt(t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        i % step === 0 || i === n - 1 ? (
          <text key={l + i} x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted text-[10px]">
            {l}
          </text>
        ) : null,
      )}
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean) as string[];
        return (
          <g key={si}>
            <polyline points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
            {s.values.map((v, i) =>
              v == null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color}>
                  <title>
                    {labels[i]}: {fmt(v)}
                  </title>
                </circle>
              ),
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function CampaignCharts({
  series,
  campSeries,
  campaigns,
  monthly,
}: {
  series: Point[];
  campSeries: CampPoint[];
  campaigns: { id: string; name: string }[];
  monthly: boolean;
}) {
  const [metric, setMetric] = useState<Metric>("spend");
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const { fmt } = METRICS[metric];
  const labels = series.map((p) => label(p.d, monthly));

  // Chart B: eixo de datas unificado (todas as datas presentes), uma série por campanha visível.
  const dates = Array.from(new Set(campSeries.map((p) => p.d))).sort();
  const campLabels = dates.map((d) => label(d, monthly));
  const color = (id: string) => COLORS[campaigns.findIndex((c) => c.id === id) % COLORS.length];
  const campLines = campaigns
    .filter((c) => !hidden[c.id])
    .map((c) => ({
      color: color(c.id),
      values: dates.map((d) => {
        const p = campSeries.find((r) => r.cid === c.id && r.d === d);
        return p ? metricValue(p, metric) : null;
      }),
    }));

  return (
    <div className="mb-6 grid gap-6 xl:grid-cols-2">
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Evolução no tempo</h3>
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className="input h-8 w-36 text-sm">
            {(Object.keys(METRICS) as Metric[]).map((m) => (
              <option key={m} value={m}>
                {METRICS[m].label}
              </option>
            ))}
          </select>
        </div>
        {series.length ? (
          <LineChart series={[{ color: COLORS[0], values: series.map((p) => metricValue(p, metric)) }]} labels={labels} fmt={fmt} />
        ) : (
          <p className="py-10 text-center text-sm text-muted">Sem dados no período.</p>
        )}
      </section>

      <section className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">Campanha vs campanha ({METRICS[metric].label})</h3>
        {campaigns.length ? (
          <>
            <LineChart series={campLines} labels={campLabels} fmt={fmt} />
            <div className="mt-3 flex flex-wrap gap-2">
              {campaigns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setHidden((h) => ({ ...h, [c.id]: !h[c.id] }))}
                  className={`flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs ${hidden[c.id] ? "opacity-40" : ""}`}
                >
                  <span className="inline-block size-2 rounded-full" style={{ background: color(c.id) }} />
                  {c.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="py-10 text-center text-sm text-muted">Sem campanhas no período.</p>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Consultar as séries temporais na página**

Em `page.tsx`, após o bloco de `delta` (Task 5), adicione:

```ts
  const monthly = len > 60;
  const bucket = monthly ? sql`date_trunc('month', i.date)::date` : sql`i.date`;
  const seriesRes = await db.execute(sql`
    select ${bucket} as d,
      coalesce(sum(i.spend_cents),0)::bigint as spend,
      (coalesce(sum(i.leads),0) + coalesce(sum(i.messages_started),0))::bigint as leads,
      coalesce(sum(i.clicks),0)::bigint as clicks
    from meta_insights_daily i
    join meta_campaigns c on c.company_id = i.company_id and c.meta_campaign_id = i.meta_campaign_id
    where i.company_id = ${ctx.companyId} and i.date between ${de} and ${ate}
    ${sp.todas ? sql`` : sql`and c.status = 'ACTIVE'`}
    group by d order by d
  `);
  const series = (seriesRes.rows as Record<string, unknown>[]).map((r) => ({
    d: String(r.d).slice(0, 10),
    spend: Number(r.spend),
    leads: Number(r.leads),
    clicks: Number(r.clicks),
  }));

  const topCampaigns = list.slice(0, 5).map((c) => ({ id: c.id, name: c.name }));
  const campSeriesRes = await db.execute(sql`
    select ${bucket} as d, i.meta_campaign_id as cid,
      coalesce(sum(i.spend_cents),0)::bigint as spend,
      (coalesce(sum(i.leads),0) + coalesce(sum(i.messages_started),0))::bigint as leads,
      coalesce(sum(i.clicks),0)::bigint as clicks
    from meta_insights_daily i
    where i.company_id = ${ctx.companyId} and i.date between ${de} and ${ate}
    group by d, cid order by d
  `);
  const topIds = new Set(topCampaigns.map((c) => c.id));
  const campSeries = (campSeriesRes.rows as Record<string, unknown>[])
    .filter((r) => topIds.has(String(r.cid)))
    .map((r) => ({
      d: String(r.d).slice(0, 10),
      cid: String(r.cid),
      spend: Number(r.spend),
      leads: Number(r.leads),
      clicks: Number(r.clicks),
    }));
```

- [ ] **Step 3: Renderizar os gráficos**

Adicione o import em `page.tsx`:

```ts
import { CampaignCharts } from "./charts";
```

Renderize os gráficos entre o grid de StatCards e a tabela (logo após o `</div>` que fecha o grid `mb-6 grid ... xl:grid-cols-4`):

```tsx
      {list.length > 0 && <CampaignCharts series={series} campSeries={campSeries} campaigns={topCampaigns} monthly={monthly} />}
```

- [ ] **Step 4: Verificar tipos/lint e conferir no app**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.
Manual: `/campanhas` com dados importados — ver os dois gráficos; trocar a métrica no seletor; ligar/desligar campanhas nos chips; mudar o período para um intervalo > 60 dias e confirmar que o eixo passa a ser mensal (ex.: "set/25").

- [ ] **Step 5: Commit**

```bash
git add app/src/app/\(app\)/campanhas/charts.tsx app/src/app/\(app\)/campanhas/page.tsx
git commit -m "feat(campanhas): gráficos de evolução e campanha vs campanha (SVG)"
```

---

## Verificação final

- [ ] Rodar `npm run typecheck && npm run lint && npm run build` — tudo passa.
- [ ] Fluxo completo no app: importar histórico → trocar período (atalhos e De/Até) → ver variação % nos cartões → interagir com os dois gráficos.
```