import { MoneyInput } from "@/components/money-input";
import { centsToInput } from "@/lib/utils";
import { COMPANY_SERVICES, PAYMENT_METHODS, SERVICE_BILLINGS, type CompanyService } from "@/lib/services";

/** Seleção de serviços + forma de pagamento da comanda. Usado no cadastro e na edição da empresa. */
export function ServicesPicker({ current, paymentMethod }: { current?: CompanyService[]; paymentMethod?: string | null }) {
  return (
    <fieldset>
      <span className="label">Serviços contratados</span>
      <div className="mt-1 space-y-2">
        <div className="grid grid-cols-[1fr_6.5rem_5.5rem_4.5rem] items-center gap-2 text-[11px] tracking-wide text-muted uppercase">
          <span />
          <span className="pl-1">Valor</span>
          <span className="pl-1">Recorrência</span>
          <span className="pl-1">Parcelas</span>
        </div>
        {COMPANY_SERVICES.map((s) => {
          const cur = current?.find((c) => c.service === s.key);
          return (
            <div key={s.key} className="grid grid-cols-[1fr_6.5rem_5.5rem_4.5rem] items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name={`svc_${s.key}`} defaultChecked={!!cur} className="size-4 rounded accent-brand-500" />
                {s.label}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">R$</span>
                <MoneyInput name={`value_${s.key}`} defaultValue={cur ? centsToInput(cur.valueCents) : ""} className="input pl-7" />
              </div>
              <select name={`billing_${s.key}`} defaultValue={cur?.billing ?? "monthly"} className="input">
                {SERVICE_BILLINGS.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                name={`installments_${s.key}`}
                min={1}
                max={120}
                defaultValue={cur?.installments ?? 12}
                title="Nº de parcelas"
                className="input"
              />
            </div>
          );
        })}
      </div>
      <label className="mt-3 block">
        <span className="label">Forma de pagamento</span>
        <select name="paymentMethod" defaultValue={paymentMethod ?? ""} className="input">
          <option value="">Selecione...</option>
          {PAYMENT_METHODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
