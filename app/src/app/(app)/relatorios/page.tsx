import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AutoSubmitInput } from "@/components/auto-submit";
import { PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { money, monthLabel, monthRange, todayISO, ucfirst } from "@/lib/utils";

export const metadata = { title: "Relatórios" };

type Row = Record<string, unknown>;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, "reports.viewAll")) redirect("/dashboard");
  const { mes } = await searchParams;
  const month = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : todayISO().slice(0, 7);
  const { start, end } = monthRange(month);
  const cid = ctx.companyId;

  const [bySource, funnel, trend, losses, topProcedures] = await Promise.all([
    db.execute(sql`
      select coalesce(s.name, 'Sem origem') as name, count(c.id) as leads,
        count(c.id) filter (where c.status = 'client') as clients
      from contacts c left join lead_sources s on s.id = c.source_id
      where c.company_id = ${cid} and c.deleted_at is null and c.created_at >= ${start} and c.created_at < ${end}
      group by 1 order by 2 desc`),
    db.execute(sql`
      select s.name, s.color, count(d.id) as n, coalesce(sum(d.value_cents),0) as value
      from pipeline_stages s left join deals d on d.stage_id = s.id and d.deleted_at is null
      where s.company_id = ${cid} group by s.id order by s.position`),
    db.execute(sql`
      select to_char(date_trunc('month', o.confirmed_at at time zone 'America/Sao_Paulo'), 'YYYY-MM') as m,
        sum(o.total_cents) as revenue, count(*) as orders
      from orders o where o.company_id = ${cid} and o.status in ('confirmed','paid')
        and o.confirmed_at >= now() - interval '6 months'
      group by 1 order by 1`),
    db.execute(sql`
      select coalesce(r.name, 'Sem motivo') as name, count(*) as n
      from deals d left join loss_reasons r on r.id = d.loss_reason_id
      where d.company_id = ${cid} and d.lost_at >= ${start} and d.lost_at < ${end}
      group by 1 order by 2 desc`),
    db.execute(sql`
      select p.name, count(*) as n
      from appointments a join procedures p on p.id = a.procedure_id
      where a.company_id = ${cid} and a.status = 'done' and a.starts_at >= ${start} and a.starts_at < ${end}
      group by 1 order by 2 desc limit 10`),
  ]);

  const trendRows = trend.rows as Row[];
  const maxRev = Math.max(1, ...trendRows.map((r) => Number(r.revenue)));
  const funnelRows = funnel.rows as Row[];
  const maxFunnel = Math.max(1, ...funnelRows.map((r) => Number(r.n)));

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle={<span>{ucfirst(monthLabel(month))}</span>}
        actions={
          <form>
            <AutoSubmitInput type="month" name="mes" defaultValue={month} className="input w-44" />
          </form>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Faturamento dos últimos 6 meses</h2>
          <div className="flex h-48 items-end gap-3">
            {trendRows.map((r) => (
              <div key={String(r.m)} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[11px] text-muted">{money(Number(r.revenue))}</span>
                <div className="w-full rounded-t-lg bg-brand-400" style={{ height: `${(Number(r.revenue) / maxRev) * 140}px` }} />
                <span className="text-xs text-muted capitalize">{monthLabel(String(r.m)).split(" ")[0].slice(0, 3)}</span>
              </div>
            ))}
            {trendRows.length === 0 && <p className="text-sm text-muted">Sem vendas confirmadas no período.</p>}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Funil agora</h2>
          <div className="space-y-2">
            {funnelRows.map((r) => (
              <div key={String(r.name)} className="flex items-center gap-3 text-sm">
                <span className="w-40 truncate">{String(r.name)}</span>
                <div className="h-6 flex-1 overflow-hidden rounded-lg bg-canvas">
                  <div className="h-full rounded-lg" style={{ width: `${(Number(r.n) / maxFunnel) * 100}%`, background: String(r.color) }} />
                </div>
                <span className="w-8 text-right font-semibold">{Number(r.n)}</span>
                <span className="w-28 text-right text-muted">{money(Number(r.value))}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Leads por origem</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Origem</th>
                <th className="text-right">Leads</th>
                <th className="text-right">Viraram cliente</th>
                <th className="text-right">Conversão</th>
              </tr>
            </thead>
            <tbody>
              {(bySource.rows as Row[]).map((r) => (
                <tr key={String(r.name)}>
                  <td>{String(r.name)}</td>
                  <td className="text-right">{Number(r.leads)}</td>
                  <td className="text-right">{Number(r.clients)}</td>
                  <td className="text-right">{Number(r.leads) ? Math.round((Number(r.clients) / Number(r.leads)) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-6">
          <div className="card p-5">
            <h2 className="mb-3 text-lg font-semibold">Motivos de perda</h2>
            {(losses.rows as Row[]).map((r) => (
              <div key={String(r.name)} className="flex justify-between border-b border-line py-1.5 text-sm">
                <span>{String(r.name)}</span>
                <span className="font-semibold">{Number(r.n)}</span>
              </div>
            ))}
            {losses.rows.length === 0 && <p className="text-sm text-muted">Nenhuma perda no mês.</p>}
          </div>
          <div className="card p-5">
            <h2 className="mb-3 text-lg font-semibold">Procedimentos mais realizados</h2>
            {(topProcedures.rows as Row[]).map((r) => (
              <div key={String(r.name)} className="flex justify-between border-b border-line py-1.5 text-sm">
                <span>{String(r.name)}</span>
                <span className="font-semibold">{Number(r.n)}</span>
              </div>
            ))}
            {topProcedures.rows.length === 0 && <p className="text-sm text-muted">Nenhum atendimento realizado no mês.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
