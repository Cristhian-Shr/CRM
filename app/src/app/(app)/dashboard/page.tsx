import { and, asc, eq, lt } from "drizzle-orm";
import {
  AlertTriangle,
  Ban,
  CalendarCheck,
  CheckCircle2,
  Clock,
  DollarSign,
  HeartCrack,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { MoneyInput } from "@/components/money-input";
import { PageHeader, StatCard } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db, schema } from "@/lib/db";
import { centsToInput, cn, fmtDate, fmtDateTime, money, monthLabel, todayISO, ucfirst, zonedToUtc } from "@/lib/utils";
import { appointmentsSummary, dailySnapshot, pipelineSnapshot, rangeMetrics, receivablesSummary, revenueGoal, sellerTable } from "@/server/metrics";
import { setRevenueGoal } from "@/server/actions/settings";
import { PeriodPicker } from "./period-picker";

export const metadata = { title: "Visão Geral" };

function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function mondayOf(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=dom ... 6=sáb
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}
function nextMonth(m: string) {
  const [y, mm] = m.split("-").map(Number);
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ p?: string; d?: string; m?: string }> }) {
  const ctx = await getContext();
  const canFinance = can(ctx, "reports.viewAll");
  const sp = await searchParams;

  const p = sp.p === "dia" || sp.p === "semana" ? sp.p : "mes";
  const today = todayISO();
  const refDate = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : today;
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : today.slice(0, 7);

  // Intervalo do período (datas) e timestamps (fuso da clínica).
  let startDate: string;
  let endDate: string;
  let periodLabel: string;
  if (p === "dia") {
    startDate = refDate;
    endDate = addDaysISO(refDate, 1);
    periodLabel = `Dia · ${fmtDate(refDate)}`;
  } else if (p === "semana") {
    const mon = mondayOf(refDate);
    startDate = mon;
    endDate = addDaysISO(mon, 7);
    periodLabel = `Semana · ${fmtDate(mon)} a ${fmtDate(addDaysISO(mon, 6))}`;
  } else {
    startDate = `${month}-01`;
    endDate = `${nextMonth(month)}-01`;
    periodLabel = ucfirst(monthLabel(month));
  }
  const start = zonedToUtc(`${startDate}T00:00`);
  const end = zonedToUtc(`${endDate}T00:00`);

  const [cur, snap, sellers, goal, appts, daily] = await Promise.all([
    rangeMetrics(ctx, start, end),
    pipelineSnapshot(ctx),
    sellerTable(ctx, start, end),
    revenueGoal(ctx, month),
    appointmentsSummary(ctx, start, end),
    dailySnapshot(ctx),
  ]);
  const fin = canFinance ? await receivablesSummary(ctx, startDate, endDate) : null;

  const endOfToday = zonedToUtc(`${today}T23:59`);
  const followUps = ctx.memberId
    ? await db
        .select({
          id: schema.tasks.id,
          title: schema.tasks.title,
          dueAt: schema.tasks.dueAt,
          contactId: schema.tasks.contactId,
          contactName: schema.contacts.name,
        })
        .from(schema.tasks)
        .leftJoin(schema.contacts, eq(schema.contacts.id, schema.tasks.contactId))
        .where(
          and(
            eq(schema.tasks.companyId, ctx.companyId),
            eq(schema.tasks.assignedTo, ctx.memberId),
            eq(schema.tasks.status, "pending"),
            lt(schema.tasks.dueAt, endOfToday),
          ),
        )
        .orderBy(asc(schema.tasks.dueAt))
        .limit(10)
    : [];

  const goalPct = goal ? Math.min(100, Math.round((cur.revenue / goal) * 100)) : 0;

  return (
    <>
      <PageHeader title="Visão Geral" subtitle={<span>{periodLabel}</span>} actions={<PeriodPicker p={p} d={refDate} m={month} />} />

      {canFinance && p === "mes" && (
        <div className="card mb-6 p-5">
          <div className="mb-2 flex items-end justify-between gap-4">
            <div>
              <div className="text-xs font-medium tracking-[0.12em] text-muted uppercase">Meta de faturamento</div>
              {goal ? (
                <div className="font-display text-2xl font-bold">
                  {money(cur.revenue)} <span className="text-base font-normal text-muted">de {money(goal)}</span>
                </div>
              ) : (
                <div className="mt-1 text-sm text-muted">Nenhuma meta definida para {monthLabel(month)}.</div>
              )}
            </div>
            <div className="flex items-center gap-3">
              {goal && <span className="font-display text-2xl font-bold text-brand-500">{goalPct}%</span>}
              <Modal
                title={`Meta de faturamento · ${ucfirst(monthLabel(month))}`}
                trigger={goal ? "Editar meta" : "Definir meta"}
                triggerClassName="btn-secondary text-xs"
              >
                <Form action={setRevenueGoal.bind(null, month)}>
                  <Field label="Meta de faturamento (R$)">
                    <MoneyInput name="target" defaultValue={goal ? centsToInput(goal) : ""} />
                  </Field>
                  <p className="text-xs text-muted">
                    Vale a partir de {monthLabel(month)}, até você definir outra meta. Deixe em 0 para remover.
                  </p>
                  <Submit>Salvar meta</Submit>
                </Form>
              </Modal>
            </div>
          </div>
          {goal && (
            <div className="h-3 overflow-hidden rounded-full bg-brand-50">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${goalPct}%` }} />
            </div>
          )}
        </div>
      )}

      <Section title="Resumo do período">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Leads novos" value={cur.leads} icon={UserPlus} />
          <StatCard label="Vendas fechadas" value={cur.won} icon={CheckCircle2} tone="green" />
          {canFinance && (
            <>
              <StatCard label="Faturamento do período" value={money(cur.revenue)} icon={DollarSign} tone="green" hint="comandas confirmadas" />
              <StatCard label="Valor em aberto" value={money(snap.openValue)} icon={Wallet} hint={`${snap.openCount} oportunidades no funil`} />
            </>
          )}
          <StatCard label="Leads parados 3d+" value={snap.stale} icon={Clock} tone="red" hint="sem mudar de etapa" />
          <StatCard label="No-show" value={cur.noShow} icon={HeartCrack} tone="amber" />
          <StatCard label="Perdidos" value={cur.lost} icon={Ban} tone="red" />
        </div>
      </Section>

      {fin && (
        <Section
          title="Contas a receber"
          action={
            <Link href="/financeiro" className="text-xs font-medium text-brand-500 hover:underline">
              Ver financeiro →
            </Link>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Previstos (período)" value={money(fin.previstos)} icon={Wallet} />
            <StatCard label="Recebidos (período)" value={money(fin.recebidos)} icon={CheckCircle2} tone="green" />
            <StatCard label="A receber (período)" value={money(fin.aReceber)} icon={Clock} tone="amber" />
            <StatCard label="Vencidos (em atraso)" value={money(fin.vencidos)} icon={AlertTriangle} tone="red" />
          </div>
        </Section>
      )}

      <Section title={`Hoje · ${fmtDate(today)}`}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {canFinance && <StatCard label="Vendas de hoje" value={money(daily.salesToday)} icon={DollarSign} tone="green" />}
          {canFinance && <StatCard label="Recebido hoje" value={money(daily.receivedToday)} icon={Wallet} tone="green" />}
          {canFinance && <StatCard label="Vence hoje" value={money(daily.dueToday)} icon={AlertTriangle} tone="amber" />}
          <StatCard label="Agendamentos hoje" value={daily.apptsToday} icon={CalendarCheck} />
          <StatCard label="Clientes do dia" value={daily.clientsToday} icon={Users} />
        </div>
      </Section>

      <Section title="Agendamentos do período">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total" value={appts.total} icon={CalendarCheck} />
          <StatCard label="Realizados" value={appts.done} icon={CheckCircle2} tone="green" />
          <StatCard label="A realizar" value={appts.pending} icon={Clock} tone="amber" />
        </div>
      </Section>

      <div className={cn("grid gap-6", canFinance && "xl:grid-cols-3")}>
        {canFinance && (
          <div className="card overflow-x-auto p-5 xl:col-span-2">
            <h2 className="mb-3 text-lg font-semibold">
              Faturamento por vendedora <span className="text-sm font-normal text-muted">· {periodLabel}</span>
            </h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Vendedora</th>
                  <th className="text-center">Leads</th>
                  <th className="text-center">Fechadas</th>
                  <th className="text-right">Faturado</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="text-center">{s.leads}</td>
                    <td className="text-center font-semibold text-green-600">{s.won}</td>
                    <td className="text-right">{money(s.revenue)}</td>
                  </tr>
                ))}
                {sellers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-muted">
                      Nenhuma vendedora cadastrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Meus follow-ups de hoje</h2>
          <div className="space-y-2">
            {followUps.map((t) => (
              <Link
                key={t.id}
                href={t.contactId ? `/clientes/${t.contactId}` : "/tarefas"}
                className="block rounded-xl border border-line p-3 text-sm hover:bg-brand-50"
              >
                <div className="font-medium">{t.title}</div>
                <div className={cn("text-xs", t.dueAt < new Date() ? "text-red-600" : "text-muted")}>
                  {t.contactName ? `${t.contactName} · ` : ""}
                  {fmtDateTime(t.dueAt)}
                </div>
              </Link>
            ))}
            {followUps.length === 0 && <p className="text-sm text-muted">Nenhum follow-up pendente para hoje.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
