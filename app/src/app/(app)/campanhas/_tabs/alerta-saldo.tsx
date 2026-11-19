import { Field, Form, Submit } from "@/components/form";
import { Empty } from "@/components/ui";
import type { getContext } from "@/lib/auth";
import type { schema } from "@/lib/db";
import { money } from "@/lib/utils";
import { saveBalanceAlert } from "@/server/actions/campaigns";

type Ctx = Awaited<ReturnType<typeof getContext>>;
type Conn = typeof schema.metaConnections.$inferSelect;

export async function AlertaSaldoTab({ ctx, conns }: { ctx: Ctx; conns: Conn[] }) {
  if (!ctx.isMaster) return <Empty>Somente o admin mestre configura o alerta de saldo.</Empty>;
  const prepaid = conns.filter((c) => c.fundingType === "prepaid");
  const postpaid = conns.filter((c) => c.fundingType !== "prepaid");
  return (
    <div className="space-y-6">
      {prepaid.length === 0 && (
        <Empty>Nenhuma conta pré-paga detectada. O alerta de saldo só se aplica a contas com recarga (boleto/pix).</Empty>
      )}
      {prepaid.map((c) => (
        <section key={c.id} className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">{c.accountName ?? c.adAccountId}</h3>
            <span className="text-sm text-muted">Saldo atual: {c.balanceCents != null ? money(c.balanceCents) : "—"}</span>
          </div>
          <Form action={saveBalanceAlert} resetOnSuccess={false} className="flex flex-wrap items-end gap-4">
            <input type="hidden" name="connectionId" value={c.id} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={c.alertEnabled} /> Ativar alerta
            </label>
            <Field label="Avisar quando saldo for menor que (R$)">
              <input
                name="limit"
                className="input"
                defaultValue={c.lowBalanceAlertCents != null ? (c.lowBalanceAlertCents / 100).toString() : ""}
              />
            </Field>
            <Field label="WhatsApp de destino">
              <input name="phone" className="input" defaultValue={c.alertPhone ?? ""} placeholder="5551999999999" />
            </Field>
            <Submit>Salvar</Submit>
          </Form>
        </section>
      ))}
      {postpaid.map((c) => (
        <section key={c.id} className="card p-4 text-sm text-muted">
          {c.accountName ?? c.adAccountId}: conta pós-paga — sem alerta de saldo.
        </section>
      ))}
    </div>
  );
}
