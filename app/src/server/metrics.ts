import "server-only";
import { and, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from "drizzle-orm";
import type { Ctx } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { can } from "@/lib/permissions";
import { todayISO, zonedToUtc } from "@/lib/utils";

const { contacts, deals, orders, appointments, pipelineStages, receivables } = schema;

function n(v: unknown) {
  return Number(v ?? 0);
}

/** Indicadores do painel para um mês ("2026-10"). Colaborador vê só os próprios números. */
/** Indicadores do painel para um intervalo [start, end). */
export async function rangeMetrics(ctx: Ctx, start: Date, end: Date) {
  const own = !can(ctx, "reports.viewAll") && ctx.memberId ? ctx.memberId : null;
  const inRange = (col: Parameters<typeof gte>[0]) => and(gte(col, start), lt(col, end));
  const ownerIs = (col: Parameters<typeof eq>[0]): SQL | undefined => (own ? eq(col, own) : undefined);

  const [leads] = await db
    .select({ v: sql`count(*)` })
    .from(contacts)
    .where(and(eq(contacts.companyId, ctx.companyId), isNull(contacts.deletedAt), inRange(contacts.createdAt), ownerIs(contacts.ownerId)));

  const [won] = await db
    .select({ v: sql`count(*)`, value: sql`coalesce(sum(${deals.valueCents}),0)` })
    .from(deals)
    .where(and(eq(deals.companyId, ctx.companyId), isNull(deals.deletedAt), inRange(deals.wonAt), ownerIs(deals.ownerId)));

  const [lost] = await db
    .select({ v: sql`count(*)` })
    .from(deals)
    .where(and(eq(deals.companyId, ctx.companyId), isNull(deals.deletedAt), inRange(deals.lostAt), ownerIs(deals.ownerId)));

  const [revenue] = await db
    .select({ v: sql`coalesce(sum(${orders.totalCents}),0)` })
    .from(orders)
    .where(
      and(
        eq(orders.companyId, ctx.companyId),
        inArray(orders.status, ["confirmed", "paid"]),
        inRange(orders.confirmedAt),
        ownerIs(orders.sellerId),
      ),
    );

  const [appts] = await db
    .select({ v: sql`count(*)` })
    .from(appointments)
    .where(and(eq(appointments.companyId, ctx.companyId), inRange(appointments.createdAt)));

  const [noShow] = await db
    .select({ v: sql`count(*)` })
    .from(appointments)
    .where(and(eq(appointments.companyId, ctx.companyId), eq(appointments.status, "no_show"), inRange(appointments.startsAt)));

  return {
    leads: n(leads.v),
    won: n(won.v),
    wonValue: n(won.value),
    lost: n(lost.v),
    revenue: n(revenue.v),
    appointments: n(appts.v),
    noShow: n(noShow.v),
  };
}

/** Retrato de agora: valor em aberto e leads parados. */
export async function pipelineSnapshot(ctx: Ctx) {
  const own = !can(ctx, "reports.viewAll") && ctx.memberId ? ctx.memberId : null;
  const [open] = await db
    .select({
      value: sql`coalesce(sum(${deals.valueCents}),0)`,
      count: sql`count(*)`,
      stale: sql`count(*) filter (where ${deals.stageEnteredAt} < now() - interval '3 days')`,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(
      and(
        eq(deals.companyId, ctx.companyId),
        isNull(deals.deletedAt),
        eq(pipelineStages.kind, "open"),
        own ? eq(deals.ownerId, own) : undefined,
      ),
    );
  return { openValue: n(open.value), openCount: n(open.count), stale: n(open.stale) };
}

/** Tabela "Faturamento por vendedora" no intervalo [start, end). */
export async function sellerTable(ctx: Ctx, start: Date, end: Date) {
  const rows = await db.execute(sql`
    select m.id, u.name,
      (select count(*) from contacts c where c.owner_id = m.id and c.deleted_at is null
         and c.created_at >= ${start} and c.created_at < ${end}) as leads,
      (select count(*) from deals d where d.owner_id = m.id and d.deleted_at is null
         and d.won_at >= ${start} and d.won_at < ${end}) as won,
      (select coalesce(sum(o.total_cents),0) from orders o where o.seller_id = m.id and o.status in ('confirmed','paid')
         and o.confirmed_at >= ${start} and o.confirmed_at < ${end}) as revenue
    from company_members m join users u on u.id = m.user_id
    where m.company_id = ${ctx.companyId} and m.active and m.is_seller
    ${!can(ctx, "reports.viewAll") && ctx.memberId ? sql`and m.id = ${ctx.memberId}` : sql``}
    order by revenue desc, u.name
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    leads: n(r.leads),
    won: n(r.won),
    revenue: n(r.revenue),
  }));
}

export async function revenueGoal(ctx: Ctx, month: string) {
  const goal = await db.query.goals.findFirst({
    where: and(
      eq(schema.goals.companyId, ctx.companyId),
      eq(schema.goals.metric, "revenue"),
      isNull(schema.goals.memberId),
      sql`${schema.goals.startsOn} <= ${month + "-01"}`,
    ),
    orderBy: (g, { desc }) => [desc(g.startsOn)],
  });
  return goal?.target ?? null;
}

/** Contas a receber no intervalo de vencimento [startDate, endDate) + total vencido em atraso. */
export async function receivablesSummary(ctx: Ctx, startDate: string, endDate: string) {
  const today = todayISO();
  const rows = await db
    .select({ amount: receivables.amountCents, status: receivables.status })
    .from(receivables)
    .where(
      and(
        eq(receivables.companyId, ctx.companyId),
        ne(receivables.status, "canceled"),
        gte(receivables.dueDate, startDate),
        lt(receivables.dueDate, endDate),
      ),
    );
  const sum = (f: (s: string) => boolean) => rows.filter((r) => f(r.status)).reduce((a, r) => a + r.amount, 0);
  const [{ overdue }] = await db
    .select({ overdue: sql<number>`coalesce(sum(${receivables.amountCents}),0)::int` })
    .from(receivables)
    .where(and(eq(receivables.companyId, ctx.companyId), eq(receivables.status, "pending"), lt(receivables.dueDate, today)));
  return {
    previstos: sum(() => true),
    recebidos: sum((s) => s === "paid"),
    aReceber: sum((s) => s === "pending"),
    vencidos: Number(overdue),
  };
}

/** Números de hoje (fuso da clínica): caixa, agenda e clientes do dia. */
export async function dailySnapshot(ctx: Ctx) {
  const today = todayISO();
  const tomorrow = todayISO(undefined, new Date(Date.now() + 86_400_000));
  const dayStart = zonedToUtc(`${today}T00:00`);
  const dayEnd = zonedToUtc(`${tomorrow}T00:00`);

  const [sales] = await db
    .select({ v: sql<number>`coalesce(sum(${orders.totalCents}),0)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.companyId, ctx.companyId),
        inArray(orders.status, ["confirmed", "paid"]),
        gte(orders.confirmedAt, dayStart),
        lt(orders.confirmedAt, dayEnd),
      ),
    );
  const [received] = await db
    .select({ v: sql<number>`coalesce(sum(${receivables.amountCents}),0)::int` })
    .from(receivables)
    .where(
      and(
        eq(receivables.companyId, ctx.companyId),
        eq(receivables.status, "paid"),
        gte(receivables.paidAt, dayStart),
        lt(receivables.paidAt, dayEnd),
      ),
    );
  const [dueToday] = await db
    .select({ v: sql<number>`coalesce(sum(${receivables.amountCents}),0)::int` })
    .from(receivables)
    .where(and(eq(receivables.companyId, ctx.companyId), eq(receivables.status, "pending"), eq(receivables.dueDate, today)));
  const [appts] = await db
    .select({ v: sql<number>`count(*)::int`, clients: sql<number>`count(distinct ${appointments.contactId})::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.companyId, ctx.companyId),
        ne(appointments.status, "cancelled"),
        gte(appointments.startsAt, dayStart),
        lt(appointments.startsAt, dayEnd),
      ),
    );
  return {
    salesToday: Number(sales.v),
    receivedToday: Number(received.v),
    dueToday: Number(dueToday.v),
    apptsToday: Number(appts.v),
    clientsToday: Number(appts.clients),
  };
}

/** Agendamentos por situação (pela data do atendimento) no intervalo [start, end). */
export async function appointmentsSummary(ctx: Ctx, start: Date, end: Date) {
  const rows = await db
    .select({ status: appointments.status, v: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(eq(appointments.companyId, ctx.companyId), gte(appointments.startsAt, start), lt(appointments.startsAt, end)))
    .groupBy(appointments.status);
  const by = (s: string) => Number(rows.find((r) => r.status === s)?.v ?? 0);
  const total = rows.filter((r) => r.status !== "cancelled").reduce((a, r) => a + Number(r.v), 0);
  const done = by("done");
  const noShow = by("no_show");
  return { total, done, noShow, pending: total - done - noShow };
}
