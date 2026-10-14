"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useActionState, useState } from "react";
import { Submit } from "@/components/form";
import { generateServicePayments, setPaymentStatus } from "@/server/actions/master";
import { Money } from "@/components/values-visibility";
import { fmtISODate } from "@/lib/utils";
import type { ActionResult } from "@/server/safe";

type Payment = { id: string; dueDate: string; valueCents: number; status: string };
type Mode = "monthly" | "installment" | "once";

export function PaymentManager({
  companyId,
  service,
  defaultValueCents,
  billing,
  today,
  payments,
}: {
  companyId: string;
  service: string;
  defaultValueCents: number;
  billing: string;
  today: string;
  payments: Payment[];
}) {
  const [mode, setMode] = useState<Mode>(billing === "one_time" ? "installment" : "monthly");
  const defaultValue = (defaultValueCents / 100).toFixed(2).replace(".", ",");
  const dueDay = Number(today.slice(8, 10));

  const [state, action] = useActionState(
    async (_prev: ActionResult, fd: FormData) => generateServicePayments(companyId, service, fd),
    undefined,
  );

  const totalCents = payments.reduce((a, p) => a + p.valueCents, 0);
  const paidCents = payments.filter((p) => p.status === "paid").reduce((a, p) => a + p.valueCents, 0);

  const tabs: { k: Mode; label: string }[] = [
    { k: "monthly", label: "Mensal" },
    { k: "installment", label: "Parcelado" },
    { k: "once", label: "Único" },
  ];

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-3 rounded-xl border border-line p-4">
        <input type="hidden" name="mode" value={mode} />
        <div className="flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setMode(t.k)}
              className={mode === t.k ? "btn-primary text-xs" : "btn-secondary text-xs"}
            >
              {t.label}
            </button>
          ))}
        </div>

        {mode === "monthly" && (
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="label">Valor mensal</span>
              <input name="value" defaultValue={defaultValue} className="input" />
            </label>
            <label className="block">
              <span className="label">Dia do vencimento</span>
              <input name="dueDay" type="number" min={1} max={31} defaultValue={dueDay} className="input" />
            </label>
            <label className="block">
              <span className="label">Início</span>
              <input name="startDate" type="date" defaultValue={today} className="input" />
            </label>
          </div>
        )}

        {mode === "installment" && (
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="label">Valor total</span>
              <input name="total" defaultValue={defaultValue} className="input" />
            </label>
            <label className="block">
              <span className="label">Nº de parcelas</span>
              <input name="count" type="number" min={1} max={120} defaultValue={2} className="input" />
            </label>
            <label className="block">
              <span className="label">1ª parcela</span>
              <input name="firstDate" type="date" defaultValue={today} className="input" />
            </label>
          </div>
        )}

        {mode === "once" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Valor</span>
              <input name="value" defaultValue={defaultValue} className="input" />
            </label>
            <label className="block">
              <span className="label">Data do pagamento</span>
              <input name="dueDate" type="date" defaultValue={today} className="input" />
            </label>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">Gerar substitui os pagamentos pendentes. Os já pagos são mantidos.</p>
          <Submit>Gerar agenda</Submit>
        </div>
        {state?.error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      </form>

      {payments.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Pagamentos ({payments.length})</span>
            <span className="text-muted">
              Pago <Money value={paidCents} /> de <Money value={totalCents} />
            </span>
          </div>
          <div className="divide-y divide-line rounded-xl border border-line">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>{fmtISODate(p.dueDate)}</span>
                <Money value={p.valueCents} />
                <form action={setPaymentStatus.bind(null, p.id, p.status === "paid" ? "pending" : "paid")}>
                  <button
                    className={
                      p.status === "paid"
                        ? "inline-flex items-center gap-1 text-xs font-medium text-emerald-600"
                        : "inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
                    }
                  >
                    {p.status === "paid" ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                    {p.status === "paid" ? "Pago" : "Marcar pago"}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">Nenhum pagamento agendado ainda. Gere a agenda acima.</p>
      )}
    </div>
  );
}
