import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fmtISODate, monthLabel, ucfirst } from "@/lib/utils";

export type ReportGroup = "day" | "week" | "month";

/** Normaliza o parâmetro de agrupamento, caindo em "day" por padrão. */
export function normGroup(g: string | undefined | null): ReportGroup {
  return g === "week" || g === "month" ? g : "day";
}

export type ReportBucket = { bucket: string; leads: number; appts: number; sales: number; revenue: number };
export type ReportTotals = { leads: number; appts: number; sales: number; revenue: number };
export type OperationalReport = { rows: ReportBucket[]; totals: ReportTotals };

/**
 * Relatório operacional: leads que entraram, agendamentos, vendas confirmadas e
 * faturamento, agrupados por dia/semana/mês dentro do intervalo [from, to] (datas
 * puras "AAAA-MM-DD" no fuso da clínica). Buckets vazios aparecem zerados.
 */
export async function operationalReport(
  companyId: string,
  from: string,
  to: string,
  group: ReportGroup,
): Promise<OperationalReport> {
  const unit = sql.raw(`'${group}'`); // group já validado por normGroup
  const step = sql.raw(`'1 ${group}'`);
  const res = await db.execute(sql`
    with buckets as (
      select generate_series(
        date_trunc(${unit}, ${from}::date),
        date_trunc(${unit}, ${to}::date),
        ${step}::interval
      )::date as b
    )
    select b.b::text as bucket,
      coalesce(l.n, 0)::int as leads,
      coalesce(a.n, 0)::int as appts,
      coalesce(o.n, 0)::int as sales,
      coalesce(o.revenue, 0)::int as revenue
    from buckets b
    left join (
      select date_trunc(${unit}, (created_at at time zone 'America/Sao_Paulo'))::date b, count(*) n
      from contacts
      where company_id = ${companyId} and deleted_at is null
        and (created_at at time zone 'America/Sao_Paulo')::date between ${from}::date and ${to}::date
      group by 1
    ) l on l.b = b.b
    left join (
      select date_trunc(${unit}, (starts_at at time zone 'America/Sao_Paulo'))::date b, count(*) n
      from appointments
      where company_id = ${companyId} and status <> 'cancelled'
        and (starts_at at time zone 'America/Sao_Paulo')::date between ${from}::date and ${to}::date
      group by 1
    ) a on a.b = b.b
    left join (
      select date_trunc(${unit}, (confirmed_at at time zone 'America/Sao_Paulo'))::date b,
             count(*) n, sum(total_cents) revenue
      from orders
      where company_id = ${companyId} and status in ('confirmed', 'paid') and confirmed_at is not null
        and (confirmed_at at time zone 'America/Sao_Paulo')::date between ${from}::date and ${to}::date
      group by 1
    ) o on o.b = b.b
    order by b.b
  `);
  const rows = res.rows as unknown as ReportBucket[];
  const totals = rows.reduce<ReportTotals>(
    (t, r) => ({
      leads: t.leads + r.leads,
      appts: t.appts + r.appts,
      sales: t.sales + r.sales,
      revenue: t.revenue + r.revenue,
    }),
    { leads: 0, appts: 0, sales: 0, revenue: 0 },
  );
  return { rows, totals };
}

/** Rótulo de um bucket conforme o agrupamento. */
export function bucketLabel(bucket: string, group: ReportGroup): string {
  if (group === "month") return ucfirst(monthLabel(bucket.slice(0, 7)));
  if (group === "week") return `Semana de ${fmtISODate(bucket)}`;
  return fmtISODate(bucket);
}
