"use client";

import { CheckCircle2, Circle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addExtraPayments,
  deletePayment,
  generateServicePayments,
  setPaymentStatus,
  setPaymentValue,
  setServiceInstallments,
} from "@/server/actions/master";
import { centsToInput, fmtISODate, parseMoney } from "@/lib/utils";
import { Money } from "@/components/values-visibility";
import { serviceMeta } from "@/lib/services";

type Payment = { id: string; service: string; dueDate: string; valueCents: number; status: string; note?: string | null };
type Svc = { service: string; installments: number; valueCents: number; billing: string };
type Mode = "monthly" | "installment" | "once";

function InstallmentsControl({
  defaultCount,
  disabled,
  onApply,
}: {
  defaultCount: number;
  disabled: boolean;
  onApply: (n: number) => void;
}) {
  const [n, setN] = useState(defaultCount);
  return (
    <div className="mt-3 flex items-center gap-2 text-sm">
      <span className="text-xs text-muted">Nº de parcelas</span>
      <input
        type="number"
        min={1}
        max={120}
        value={n}
        onChange={(e) => setN(Number(e.target.value))}
        className="input w-20 py-1"
      />
      <button type="button" disabled={disabled} onClick={() => onApply(n)} className="btn-secondary text-xs">
        Aplicar
      </button>
    </div>
  );
}

function ServiceGenerator({
  defaultValueCents,
  billing,
  today,
  disabled,
  onGenerate,
}: {
  defaultValueCents: number;
  billing: string;
  today: string;
  disabled: boolean;
  onGenerate: (fd: FormData) => void;
}) {
  const [mode, setMode] = useState<Mode>(billing === "one_time" ? "installment" : "monthly");
  const defaultValue = centsToInput(defaultValueCents);
  const dueDay = Number(today.slice(8, 10));

  const [value, setValue] = useState(defaultValue);
  const [dueDayV, setDueDayV] = useState(String(dueDay));
  const [startDate, setStartDate] = useState(today);
  const [total, setTotal] = useState(defaultValue);
  const [count, setCount] = useState("2");
  const [firstDate, setFirstDate] = useState(today);
  const [onceValue, setOnceValue] = useState(defaultValue);
  const [dueDate, setDueDate] = useState(today);

  const tabs: { k: Mode; label: string }[] = [
    { k: "monthly", label: "Mensal" },
    { k: "installment", label: "Parcelado" },
    { k: "once", label: "Único" },
  ];

  const generate = () => {
    const fd = new FormData();
    fd.set("mode", mode);
    if (mode === "monthly") {
      fd.set("value", value);
      fd.set("dueDay", dueDayV);
      fd.set("startDate", startDate);
    } else if (mode === "installment") {
      fd.set("total", total);
      fd.set("count", count);
      fd.set("firstDate", firstDate);
    } else {
      fd.set("value", onceValue);
      fd.set("dueDate", dueDate);
    }
    onGenerate(fd);
  };

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-line p-3">
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
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="label">Valor mensal</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="label">Dia do vencimento</span>
            <input type="number" min={1} max={31} value={dueDayV} onChange={(e) => setDueDayV(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="label">Início</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
          </label>
        </div>
      )}

      {mode === "installment" && (
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="label">Valor total</span>
            <input value={total} onChange={(e) => setTotal(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="label">Nº de parcelas</span>
            <input type="number" min={1} max={120} value={count} onChange={(e) => setCount(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="label">1ª parcela</span>
            <input type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} className="input" />
          </label>
        </div>
      )}

      {mode === "once" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">Valor</span>
            <input value={onceValue} onChange={(e) => setOnceValue(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="label">Data do pagamento</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
          </label>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">Gerar substitui os pagamentos pendentes. Os já pagos são mantidos.</p>
        <button type="button" disabled={disabled} onClick={generate} className="btn-primary text-xs">
          Gerar agenda
        </button>
      </div>
    </div>
  );
}

/** Valor de um lançamento, editável inline (clica → digita → Enter/blur salva). */
function EditableValue({
  valueCents,
  disabled,
  onSave,
}: {
  valueCents: number;
  disabled: boolean;
  onSave: (cents: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(centsToInput(valueCents));

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setV(centsToInput(valueCents));
          setEditing(true);
        }}
        className="tabular-nums underline decoration-dotted underline-offset-2 hover:text-ink"
        title="Editar valor"
      >
        <Money value={valueCents} />
      </button>
    );
  }

  const save = () => {
    setEditing(false);
    const cents = parseMoney(v);
    if (cents !== valueCents) onSave(cents);
  };

  return (
    <input
      autoFocus
      value={v}
      inputMode="numeric"
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
        if (e.key === "Escape") setEditing(false);
      }}
      className="input w-24 py-0.5 text-right"
    />
  );
}

/** Formulário para lançar um valor EXTRA (avulso) na comanda: único, mensal ou parcelado. */
function ExtraForm({ today, disabled, onAdd }: { today: string; disabled: boolean; onAdd: (fd: FormData) => void }) {
  const [mode, setMode] = useState<Mode>("once");
  const [note, setNote] = useState("");
  const [value, setValue] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [dueDayV, setDueDayV] = useState(String(Number(today.slice(8, 10))));
  const [startDate, setStartDate] = useState(today);
  const [total, setTotal] = useState("");
  const [count, setCount] = useState("2");
  const [firstDate, setFirstDate] = useState(today);

  const tabs: { k: Mode; label: string }[] = [
    { k: "once", label: "Único" },
    { k: "monthly", label: "Mensal" },
    { k: "installment", label: "Parcelado" },
  ];

  const add = () => {
    const fd = new FormData();
    fd.set("note", note);
    fd.set("mode", mode);
    if (mode === "once") {
      fd.set("value", value);
      fd.set("dueDate", dueDate);
    } else if (mode === "installment") {
      fd.set("total", total);
      fd.set("count", count);
      fd.set("firstDate", firstDate);
    } else {
      fd.set("value", value);
      fd.set("dueDay", dueDayV);
      fd.set("startDate", startDate);
    }
    onAdd(fd);
    setNote("");
    setValue("");
    setTotal("");
  };

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Lançar valor extra</span>
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
      </div>

      <label className="block">
        <span className="label">Descrição</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Impulsionamento extra" className="input" />
      </label>

      {mode === "once" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">Valor</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" className="input" />
          </label>
          <label className="block">
            <span className="label">Data</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
          </label>
        </div>
      )}

      {mode === "monthly" && (
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="label">Valor mensal</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" className="input" />
          </label>
          <label className="block">
            <span className="label">Dia venc.</span>
            <input type="number" min={1} max={31} value={dueDayV} onChange={(e) => setDueDayV(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="label">Início</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
          </label>
        </div>
      )}

      {mode === "installment" && (
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="label">Valor total</span>
            <input value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" className="input" />
          </label>
          <label className="block">
            <span className="label">Nº de parcelas</span>
            <input type="number" min={1} max={120} value={count} onChange={(e) => setCount(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="label">1ª parcela</span>
            <input type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} className="input" />
          </label>
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" disabled={disabled} onClick={add} className="btn-primary text-xs">
          Lançar extra
        </button>
      </div>
    </div>
  );
}

/** Gerencia os lançamentos de uma comanda: gerar agenda, marcar pago/pendente, excluir e nº de parcelas. Ao vivo. */
export function PaymentsManager({
  companyId,
  payments,
  services,
  today,
}: {
  companyId: string;
  payments: Payment[];
  services: Svc[];
  today: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  if (!services.length && !payments.length) {
    return <p className="text-sm text-muted">Nenhum serviço nesta comanda.</p>;
  }

  // Grupos: um por serviço contratado + um por "extra" distinto (pela descrição).
  type Group = { key: string; label: string; isExtra: boolean; service: string; rows: Payment[] };
  const groups = new Map<string, Group>();
  for (const s of services) {
    groups.set(s.service, { key: s.service, label: serviceMeta(s.service)?.label ?? s.service, isExtra: false, service: s.service, rows: [] });
  }
  for (const p of payments) {
    const isExtra = p.service === "extra";
    const key = isExtra ? `extra|${p.note ?? ""}` : p.service;
    let g = groups.get(key);
    if (!g) {
      g = { key, label: isExtra ? p.note || "Extra" : serviceMeta(p.service)?.label ?? p.service, isExtra, service: p.service, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(p);
  }

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {[...groups.values()].map((g) => {
          const rows = g.rows;
          const svc = services.find((s) => s.service === g.service);
          const paid = rows.filter((r) => r.status === "paid").reduce((a, r) => a + r.valueCents, 0);
          const total = rows.reduce((a, r) => a + r.valueCents, 0);
          return (
            <div key={g.key}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {g.label}
                  {g.isExtra && <span className="ml-2 badge bg-brand-50 text-brand-700">extra</span>}
                </span>
                <span className="text-muted">
                  Pago <Money value={paid} /> de <Money value={total} />
                </span>
              </div>

              {!g.isExtra && (
                <>
                  <ServiceGenerator
                    defaultValueCents={svc?.valueCents ?? rows[0]?.valueCents ?? 0}
                    billing={svc?.billing ?? "monthly"}
                    today={today}
                    disabled={isPending}
                    onGenerate={(fd) => run(() => generateServicePayments(companyId, g.service, fd))}
                  />
                  <InstallmentsControl
                    defaultCount={svc?.installments ?? (rows.length || 12)}
                    disabled={isPending}
                    onApply={(n) => run(() => setServiceInstallments(companyId, g.service, n))}
                  />
                </>
              )}

              {rows.length > 0 ? (
              <div className="mt-2 divide-y divide-line rounded-xl border border-line">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="flex items-center gap-1">
                      {fmtISODate(r.dueDate)} —
                      <EditableValue
                        valueCents={r.valueCents}
                        disabled={isPending}
                        onSave={(cents) => run(() => setPaymentValue(r.id, cents))}
                      />
                    </span>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => run(() => setPaymentStatus(r.id, r.status === "paid" ? "pending" : "paid"))}
                        className={
                          r.status === "paid"
                            ? "inline-flex items-center gap-1 text-xs font-medium text-emerald-600"
                            : "inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
                        }
                      >
                        {r.status === "paid" ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                        {r.status === "paid" ? "Pago" : "Marcar pago"}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => run(() => deletePayment(r.id))}
                        className="text-muted hover:text-red-600"
                        title="Excluir lançamento"
                        aria-label="Excluir lançamento"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              ) : (
                <p className="mt-2 text-sm text-muted">Sem lançamentos. Gere a agenda acima ou defina o nº de parcelas.</p>
              )}
            </div>
          );
        })}
      </div>

      <ExtraForm today={today} disabled={isPending} onAdd={(fd) => run(() => addExtraPayments(companyId, fd))} />
    </div>
  );
}
