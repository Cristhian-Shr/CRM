import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AutoSubmitInput } from "@/components/auto-submit";
import { PageHeader } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/agenda";
import { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fmtISODate, money, todayISO, zonedToUtc } from "@/lib/utils";
import { PrintButton } from "./print-button";
import { ReportSection } from "./report-section";

export const metadata = { title: "Relatórios" };

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** Soma 1 dia a uma data "YYYY-MM-DD" (para tornar o fim do período inclusivo). */
function nextDay(ymd: string) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, "reports.viewAll")) redirect("/dashboard");

  const { de: deRaw, ate: ateRaw } = await searchParams;
  const today = todayISO();
  const de = isDate(deRaw) ? deRaw : `${today.slice(0, 7)}-01`;
  const ate = isDate(ateRaw) ? ateRaw : today;
  const start = zonedToUtc(`${de}T00:00`);
  const end = zonedToUtc(`${nextDay(ate)}T00:00`);
  const cid = ctx.companyId;

  const [leads, sales, openOrders, cancelledOrders, losses, apptByStatus, apptByPro] = await Promise.all([
    // Entrada de leads por origem
    db.execute(sql`
      select coalesce(s.name, 'Sem origem') as name, count(c.id) as leads,
        count(c.id) filter (where c.status = 'client') as clients
      from contacts c left join lead_sources s on s.id = c.source_id
      where c.company_id = ${cid} and c.deleted_at is null and c.created_at >= ${start} and c.created_at < ${end}
      group by 1 order by 2 desc`),
    // Vendas realizadas (comandas confirmadas/pagas) por vendedor
    db.execute(sql`
      select coalesce(u.name, 'Sem vendedor') as seller, count(o.id) as n, coalesce(sum(o.total_cents),0) as value
      from orders o
      left join company_members cm on cm.id = o.seller_id
      left join users u on u.id = cm.user_id
      where o.company_id = ${cid} and o.status in ('confirmed','paid')
        and o.confirmed_at >= ${start} and o.confirmed_at < ${end}
      group by 1 order by 3 desc`),
    // Comandas em aberto (não finalizadas)
    db.execute(sql`
      select count(*) as n, coalesce(sum(total_cents),0) as value
      from orders where company_id = ${cid} and status = 'draft'
        and created_at >= ${start} and created_at < ${end}`),
    // Comandas canceladas
    db.execute(sql`
      select count(*) as n, coalesce(sum(total_cents),0) as value
      from orders where company_id = ${cid} and status = 'cancelled'
        and created_at >= ${start} and created_at < ${end}`),
    // Negócios perdidos no funil, por motivo
    db.execute(sql`
      select coalesce(r.name, 'Sem motivo') as name, count(*) as n, coalesce(sum(d.value_cents),0) as value
      from deals d left join loss_reasons r on r.id = d.loss_reason_id
      where d.company_id = ${cid} and d.lost_at >= ${start} and d.lost_at < ${end}
      group by 1 order by 2 desc`),
    // Agendamentos por status
    db.execute(sql`
      select status, count(*) as n
      from appointments
      where company_id = ${cid} and starts_at >= ${start} and starts_at < ${end}
      group by 1`),
    // Agendamentos por colaborador
    db.execute(sql`
      select coalesce(u.name, 'Sem profissional') as pro, count(*) as total,
        count(*) filter (where a.status = 'done') as done,
        count(*) filter (where a.status in ('scheduled','confirmed','waiting','in_progress')) as upcoming,
        count(*) filter (where a.status = 'no_show') as no_show,
        count(*) filter (where a.status = 'cancelled') as cancelled
      from appointments a
      left join company_members cm on cm.id = a.professional_id
      left join users u on u.id = cm.user_id
      where a.company_id = ${cid} and a.starts_at >= ${start} and a.starts_at < ${end}
      group by 1 order by 2 desc`),
  ]);

  const leadRows = leads.rows as Row[];
  const saleRows = sales.rows as Row[];
  const lossRows = losses.rows as Row[];
  const apptStatusRows = apptByStatus.rows as Row[];
  const apptProRows = apptByPro.rows as Row[];

  const totalLeads = leadRows.reduce((s, r) => s + n(r.leads), 0);
  const salesCount = saleRows.reduce((s, r) => s + n(r.n), 0);
  const salesValue = saleRows.reduce((s, r) => s + n(r.value), 0);
  const open = openOrders.rows[0] as Row;
  const cancelled = cancelledOrders.rows[0] as Row;
  const lostCount = lossRows.reduce((s, r) => s + n(r.n), 0);
  const lostValue = lossRows.reduce((s, r) => s + n(r.value), 0);
  const apptTotal = apptStatusRows.reduce((s, r) => s + n(r.n), 0);

  const cards = [
    { label: "Leads no período", value: String(totalLeads) },
    { label: "Vendas realizadas", value: money(salesValue), hint: `${salesCount} comanda(s)` },
    { label: "Vendas não concluídas", value: String(n(open.n) + n(cancelled.n) + lostCount), hint: "abertas + canceladas + perdidas" },
    { label: "Agendamentos", value: String(apptTotal) },
  ];

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle={<span>Período de {fmtISODate(de)} até {fmtISODate(ate)}</span>}
        actions={
          <>
            <form className="flex items-end gap-2 print:hidden">
              <label className="text-xs text-muted">
                De
                <AutoSubmitInput type="date" name="de" defaultValue={de} className="input mt-0.5 w-40" />
              </label>
              <label className="text-xs text-muted">
                Até
                <AutoSubmitInput type="date" name="ate" defaultValue={ate} className="input mt-0.5 w-40" />
              </label>
            </form>
            <PrintButton />
          </>
        }
      />

      {/* Resumo */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <p className="text-xs text-muted">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold">{c.value}</p>
            {c.hint && <p className="text-xs text-muted">{c.hint}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Entrada de leads por origem */}
        <ReportSection title="Entrada de leads por origem">
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
              {leadRows.map((r) => (
                <tr key={String(r.name)}>
                  <td>{String(r.name)}</td>
                  <td className="text-right">{n(r.leads)}</td>
                  <td className="text-right">{n(r.clients)}</td>
                  <td className="text-right">{n(r.leads) ? Math.round((n(r.clients) / n(r.leads)) * 100) : 0}%</td>
                </tr>
              ))}
              {leadRows.length > 0 && (
                <tr className="font-semibold">
                  <td>Total</td>
                  <td className="text-right">{totalLeads}</td>
                  <td className="text-right">{leadRows.reduce((s, r) => s + n(r.clients), 0)}</td>
                  <td className="text-right"></td>
                </tr>
              )}
            </tbody>
          </table>
          {leadRows.length === 0 && <p className="text-sm text-muted">Nenhum lead no período.</p>}
        </ReportSection>

        {/* Vendas realizadas por vendedor */}
        <ReportSection title="Vendas realizadas por vendedor">
          <table className="table">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th className="text-right">Comandas</th>
                <th className="text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {saleRows.map((r) => (
                <tr key={String(r.seller)}>
                  <td>{String(r.seller)}</td>
                  <td className="text-right">{n(r.n)}</td>
                  <td className="text-right">{money(n(r.value))}</td>
                </tr>
              ))}
              {saleRows.length > 0 && (
                <tr className="font-semibold">
                  <td>Total</td>
                  <td className="text-right">{salesCount}</td>
                  <td className="text-right">{money(salesValue)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {saleRows.length === 0 && <p className="text-sm text-muted">Nenhuma venda concluída no período.</p>}
        </ReportSection>

        {/* Vendas não concluídas */}
        <ReportSection title="Vendas não concluídas">
          <div className="mb-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-canvas p-3">
              <p className="text-xs text-muted">Comandas em aberto</p>
              <p className="text-xl font-semibold">{n(open.n)}</p>
              <p className="text-xs text-muted">{money(n(open.value))}</p>
            </div>
            <div className="rounded-xl bg-canvas p-3">
              <p className="text-xs text-muted">Comandas canceladas</p>
              <p className="text-xl font-semibold">{n(cancelled.n)}</p>
              <p className="text-xs text-muted">{money(n(cancelled.value))}</p>
            </div>
            <div className="rounded-xl bg-canvas p-3">
              <p className="text-xs text-muted">Negócios perdidos</p>
              <p className="text-xl font-semibold">{lostCount}</p>
              <p className="text-xs text-muted">{money(lostValue)}</p>
            </div>
          </div>
          <h3 className="mb-2 text-sm font-semibold text-muted">Motivos de perda</h3>
          {lossRows.map((r) => (
            <div key={String(r.name)} className="flex justify-between border-b border-line py-1.5 text-sm">
              <span>{String(r.name)}</span>
              <span className="font-semibold">{n(r.n)}</span>
            </div>
          ))}
          {lossRows.length === 0 && <p className="text-sm text-muted">Nenhum negócio perdido no período.</p>}
        </ReportSection>

        {/* Agendamentos por status */}
        <ReportSection title="Agendamentos por status">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th className="text-right">Qtd</th>
              </tr>
            </thead>
            <tbody>
              {apptStatusRows.map((r) => (
                <tr key={String(r.status)}>
                  <td>{STATUS_LABEL[String(r.status)] ?? String(r.status)}</td>
                  <td className="text-right">{n(r.n)}</td>
                </tr>
              ))}
              {apptStatusRows.length > 0 && (
                <tr className="font-semibold">
                  <td>Total</td>
                  <td className="text-right">{apptTotal}</td>
                </tr>
              )}
            </tbody>
          </table>
          {apptStatusRows.length === 0 && <p className="text-sm text-muted">Nenhum agendamento no período.</p>}
        </ReportSection>

        {/* Agendamentos por colaborador */}
        <ReportSection title="Agendamentos por colaborador" className="xl:col-span-2">
          <table className="table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th className="text-right">Total</th>
                <th className="text-right">Atendidos</th>
                <th className="text-right">Agendados</th>
                <th className="text-right">Faltas</th>
                <th className="text-right">Desmarcados</th>
              </tr>
            </thead>
            <tbody>
              {apptProRows.map((r) => (
                <tr key={String(r.pro)}>
                  <td>{String(r.pro)}</td>
                  <td className="text-right">{n(r.total)}</td>
                  <td className="text-right">{n(r.done)}</td>
                  <td className="text-right">{n(r.upcoming)}</td>
                  <td className="text-right">{n(r.no_show)}</td>
                  <td className="text-right">{n(r.cancelled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {apptProRows.length === 0 && <p className="text-sm text-muted">Nenhum agendamento no período.</p>}
        </ReportSection>
      </div>
    </>
  );
}
