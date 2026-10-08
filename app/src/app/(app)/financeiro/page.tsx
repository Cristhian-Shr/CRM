import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, Clock, Trash2, Wallet } from "lucide-react";
import { redirect } from "next/navigation";
import { AutoSubmitInput } from "@/components/auto-submit";
import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { MoneyInput } from "@/components/money-input";
import { Empty, PageHeader, StatCard } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db, schema } from "@/lib/db";
import { PAYMENT_METHODS, paymentLabel } from "@/lib/payments";
import { fmtDate, money, monthLabel, todayISO, ucfirst } from "@/lib/utils";
import { createReceivable, deleteReceivable, setReceivableStatus } from "@/server/actions/finance";

export const metadata = { title: "Financeiro" };

function nextMonthStr(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export default async function FinanceiroPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const ctx = await getContext();
  if (!can(ctx, "reports.viewAll")) redirect("/dashboard");

  const { mes } = await searchParams;
  const month = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : todayISO().slice(0, 7);
  const monthStart = `${month}-01`;
  const nextStart = `${nextMonthStr(month)}-01`;
  const today = todayISO();

  const { receivables, contacts } = schema;

  const rows = await db
    .select({
      id: receivables.id,
      contactName: contacts.name,
      description: receivables.description,
      amountCents: receivables.amountCents,
      dueDate: receivables.dueDate,
      status: receivables.status,
      paymentMethod: receivables.paymentMethod,
      orderId: receivables.orderId,
    })
    .from(receivables)
    .innerJoin(contacts, eq(contacts.id, receivables.contactId))
    .where(and(eq(receivables.companyId, ctx.companyId), gte(receivables.dueDate, monthStart), lt(receivables.dueDate, nextStart)))
    .orderBy(asc(receivables.dueDate));

  const ativos = rows.filter((r) => r.status !== "canceled");
  const previstos = ativos.reduce((a, r) => a + r.amountCents, 0);
  const recebidos = ativos.filter((r) => r.status === "paid").reduce((a, r) => a + r.amountCents, 0);
  const aReceber = ativos.filter((r) => r.status === "pending").reduce((a, r) => a + r.amountCents, 0);

  // Vencidos: pendentes com vencimento no passado (visão geral, não só do mês).
  const [{ overdue }] = await db
    .select({ overdue: sql<number>`coalesce(sum(${receivables.amountCents}), 0)::int` })
    .from(receivables)
    .where(and(eq(receivables.companyId, ctx.companyId), eq(receivables.status, "pending"), lt(receivables.dueDate, today)));

  const clientes = await db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(and(eq(contacts.companyId, ctx.companyId), isNull(contacts.deletedAt)))
    .orderBy(asc(contacts.name))
    .limit(500);

  return (
    <>
      <PageHeader
        title="Financeiro"
        subtitle={<span>Contas a receber · {ucfirst(monthLabel(month))}</span>}
        actions={
          <div className="flex items-center gap-2">
            <form>
              <AutoSubmitInput type="month" name="mes" defaultValue={month} className="input w-44" />
            </form>
            <Modal title="Nova conta a receber" trigger="+ Nova conta">
              <Form action={createReceivable}>
                <Field label="Cliente">
                  <select name="contactId" required defaultValue="" className="input">
                    <option value="" disabled>
                      Selecione...
                    </option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Descrição">
                  <input name="description" required className="input" placeholder="Ex.: Pacote facial" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Valor (R$)">
                    <MoneyInput name="amount" required />
                  </Field>
                  <Field label="Vencimento">
                    <input name="dueDate" type="date" required defaultValue={today} className="input" />
                  </Field>
                </div>
                <Field label="Forma de pagamento">
                  <select name="paymentMethod" defaultValue="" className="input">
                    <option value="">—</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Submit>Lançar conta</Submit>
              </Form>
            </Modal>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Previstos (mês)" value={money(previstos)} icon={Wallet} />
        <StatCard label="Recebidos (mês)" value={money(recebidos)} icon={CheckCircle2} tone="green" />
        <StatCard label="A receber (mês)" value={money(aReceber)} icon={Clock} tone="amber" />
        <StatCard label="Vencidos (em atraso)" value={money(overdue)} icon={AlertTriangle} tone="red" />
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Descrição</th>
              <th>Vencimento</th>
              <th className="text-right">Valor</th>
              <th>Pagamento</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ativos.map((r) => {
              const overdueRow = r.status === "pending" && r.dueDate < today;
              return (
                <tr key={r.id}>
                  <td className="font-medium">{r.contactName}</td>
                  <td>{r.description}</td>
                  <td className={overdueRow ? "text-red-600" : ""}>{fmtDate(r.dueDate)}</td>
                  <td className="text-right">{money(r.amountCents)}</td>
                  <td className="text-muted">{paymentLabel(r.paymentMethod)}</td>
                  <td>
                    {r.status === "paid" ? (
                      <span className="badge bg-green-50 text-green-700">Recebido</span>
                    ) : overdueRow ? (
                      <span className="badge bg-red-50 text-red-700">Vencido</span>
                    ) : (
                      <span className="badge bg-amber-50 text-amber-700">A receber</span>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      <form action={setReceivableStatus.bind(null, r.id, r.status === "paid" ? "pending" : "paid")}>
                        <button className="btn-ghost text-xs">{r.status === "paid" ? "Reabrir" : "Marcar pago"}</button>
                      </form>
                      <form action={deleteReceivable.bind(null, r.id)}>
                        <button className="btn-ghost text-xs text-red-600 hover:text-red-700" title="Excluir" aria-label="Excluir">
                          <Trash2 className="size-3.5" />
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {ativos.length === 0 && (
          <div className="p-4">
            <Empty>Nenhuma conta a receber com vencimento em {ucfirst(monthLabel(month))}.</Empty>
          </div>
        )}
      </div>
    </>
  );
}
