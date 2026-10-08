import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { MoneyInput } from "@/components/money-input";
import { PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db, schema } from "@/lib/db";
import { centsToInput, cn, money, monthLabel, monthRange, TZ, todayISO, ucfirst } from "@/lib/utils";
import { setRevenueGoal } from "@/server/actions/settings";

export const metadata = { title: "Metas" };

/** "AAAA-MM" deslocado por N meses. */
function addMonths(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const idx = (y * 12 + (m - 1)) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export default async function MetasPage() {
  const ctx = await getContext();
  if (!can(ctx, "settings.manage")) redirect("/dashboard");

  const current = todayISO().slice(0, 7);
  // 6 meses atrás → 6 meses à frente (passado com realizado, atual e futuros para planejar).
  const months: string[] = [];
  for (let i = -6; i <= 6; i++) months.push(addMonths(current, i));

  // Metas de faturamento cadastradas (vale do mês definido em diante).
  const goals = await db
    .select({ startsOn: schema.goals.startsOn, target: schema.goals.target })
    .from(schema.goals)
    .where(and(eq(schema.goals.companyId, ctx.companyId), eq(schema.goals.metric, "revenue"), isNull(schema.goals.memberId)))
    .orderBy(asc(schema.goals.startsOn));
  const metaFor = (month: string) => {
    const key = `${month}-01`;
    let t: number | null = null;
    for (const g of goals) {
      if (g.startsOn <= key) t = g.target;
      else break;
    }
    return t;
  };

  // Realizado (faturamento confirmado) por mês na janela, numa consulta só.
  const { start } = monthRange(months[0]);
  const { end } = monthRange(months[months.length - 1]);
  const rev = await db.execute(sql`
    select to_char(date_trunc('month', confirmed_at at time zone ${TZ}), 'YYYY-MM') as m,
           coalesce(sum(total_cents), 0) as rev
    from orders
    where company_id = ${ctx.companyId} and status in ('confirmed','paid')
      and confirmed_at >= ${start} and confirmed_at < ${end}
    group by 1`);
  const realized = new Map((rev.rows as { m: string; rev: string | number }[]).map((r) => [String(r.m), Number(r.rev)]));

  const rows = months
    .map((month) => {
      const meta = metaFor(month);
      const realizado = month <= current ? realized.get(month) ?? 0 : null;
      const pct = meta && meta > 0 && realizado != null ? Math.round((realizado / meta) * 100) : null;
      const when = month < current ? "past" : month === current ? "current" : "future";
      return { month, meta, realizado, pct, when };
    })
    .reverse(); // mais recente/futuro no topo

  return (
    <>
      <PageHeader title="Metas" subtitle="Metas de faturamento por mês — defina os próximos e acompanhe o realizado" />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Mês</th>
              <th className="text-right">Meta</th>
              <th className="text-right">Realizado</th>
              <th className="text-right">Atingido</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className={cn(r.when === "current" && "bg-brand-50/50")}>
                <td className="font-medium capitalize">
                  {monthLabel(r.month)}
                  {r.when === "current" && <span className="ml-2 badge bg-brand-100 text-brand-700">atual</span>}
                  {r.when === "future" && <span className="ml-2 badge bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">futuro</span>}
                </td>
                <td className="text-right">{r.meta ? money(r.meta) : <span className="text-muted">—</span>}</td>
                <td className="text-right">{r.realizado != null ? money(r.realizado) : <span className="text-muted">—</span>}</td>
                <td className="text-right">
                  {r.pct != null ? (
                    <span className={cn("font-semibold", r.pct >= 100 ? "text-green-600" : r.when === "past" ? "text-red-600" : "text-ink")}>
                      {r.pct}%
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="text-right">
                  <Modal
                    title={`Meta · ${ucfirst(monthLabel(r.month))}`}
                    trigger={r.meta ? "Editar" : "Definir"}
                    triggerClassName="btn-ghost text-xs"
                  >
                    <Form action={setRevenueGoal.bind(null, r.month)}>
                      <Field label="Meta de faturamento (R$)">
                        <MoneyInput name="target" defaultValue={r.meta ? centsToInput(r.meta) : ""} />
                      </Field>
                      <p className="text-xs text-muted">
                        Vale a partir de {monthLabel(r.month)}, até você definir outra meta. Deixe em 0 para remover.
                      </p>
                      <Submit>Salvar meta</Submit>
                    </Form>
                  </Modal>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
