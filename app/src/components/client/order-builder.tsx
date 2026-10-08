"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Field, Form, Submit } from "@/components/form";
import { maskMoney } from "@/components/money-input";
import { PAYMENT_METHODS } from "@/lib/payments";
import { centsToInput, cn, money, parseMoney } from "@/lib/utils";
import { createOrder } from "@/server/actions/orders";

type Proc = { id: string; name: string; priceCents: number };
type Prog = { id: string; name: string; priceCents: number; items: { name: string; sessions: number }[] };
type Line = { type: "procedure" | "program"; id: string; name: string; unit: number; quantity: number };

export function OrderBuilder({
  contactId,
  procedures,
  programs,
  deals,
  defaultDealId,
}: {
  contactId: string;
  procedures: Proc[];
  programs: Prog[];
  deals: { id: string; title: string }[];
  defaultDealId?: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState("");
  const [discMode, setDiscMode] = useState<"value" | "percent">("value");
  const subtotal = lines.reduce((s, l) => s + l.unit * l.quantity, 0);
  const discountCents =
    discMode === "percent"
      ? Math.min(subtotal, Math.max(0, Math.round((subtotal * (Number((discount || "").replace(",", ".")) || 0)) / 100)))
      : Math.min(subtotal, parseMoney(discount));
  const total = Math.max(0, subtotal - discountCents);

  function add(value: string) {
    if (!value) return;
    const [type, id] = value.split(":") as ["procedure" | "program", string];
    const src = type === "program" ? programs.find((p) => p.id === id) : procedures.find((p) => p.id === id);
    if (!src) return;
    setLines((prev) => {
      const found = prev.find((l) => l.id === id);
      if (found) return prev.map((l) => (l.id === id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { type, id, name: src.name, unit: src.priceCents, quantity: 1 }];
    });
  }

  return (
    <Form action={createOrder.bind(null, contactId)} onSuccess={() => setLines([])}>
      <input type="hidden" name="items" value={JSON.stringify(lines.map(({ type, id, quantity }) => ({ type, id, quantity })))} />
      <Field label="Adicionar programa ou procedimento">
        <select className="input" value="" onChange={(e) => add(e.target.value)}>
          <option value="">Selecione...</option>
          <optgroup label="Programas">
            {programs.map((p) => (
              <option key={p.id} value={`program:${p.id}`}>
                {p.name} · {money(p.priceCents)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Procedimentos avulsos">
            {procedures.map((p) => (
              <option key={p.id} value={`procedure:${p.id}`}>
                {p.name} · {money(p.priceCents)}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>

      <div className="space-y-2">
        {lines.length === 0 && <p className="text-sm text-muted">Nenhum item na comanda.</p>}
        {lines.map((l) => {
          const prog = l.type === "program" ? programs.find((p) => p.id === l.id) : null;
          return (
            <div key={l.id} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="font-medium">{l.name}</div>
                  {prog && (
                    <div className="text-xs text-muted">{prog.items.map((i) => `${i.sessions * l.quantity}x ${i.name}`).join(" + ")}</div>
                  )}
                </div>
                <input
                  type="number"
                  min={1}
                  value={l.quantity}
                  onChange={(e) => setLines((p) => p.map((x) => (x.id === l.id ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))}
                  className="input w-20"
                  aria-label="Quantidade"
                />
                <div className="w-28 text-right font-semibold">{money(l.unit * l.quantity)}</div>
                <button type="button" className="btn-ghost p-1.5" onClick={() => setLines((p) => p.filter((x) => x.id !== l.id))} aria-label="Remover">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Desconto">
          <div className="flex items-center gap-1">
            <input
              className="input"
              inputMode="numeric"
              placeholder={discMode === "percent" ? "0" : "0,00"}
              value={discount}
              onChange={(e) => setDiscount(discMode === "value" ? maskMoney(e.target.value) : e.target.value)}
            />
            <div className="flex overflow-hidden rounded-lg border border-line text-xs">
              <button
                type="button"
                onClick={() => {
                  setDiscMode("value");
                  setDiscount("");
                }}
                className={cn("px-2 py-2", discMode === "value" ? "bg-brand-500 text-white" : "text-muted")}
              >
                R$
              </button>
              <button
                type="button"
                onClick={() => {
                  setDiscMode("percent");
                  setDiscount("");
                }}
                className={cn("px-2 py-2", discMode === "percent" ? "bg-brand-500 text-white" : "text-muted")}
              >
                %
              </button>
            </div>
          </div>
          <input type="hidden" name="discount" value={centsToInput(discountCents)} />
        </Field>
        <Field label="Pagamento">
          <select name="paymentMethod" className="input">
            {PAYMENT_METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Parcelas">
          <input name="installments" type="number" min={1} max={24} className="input" defaultValue={1} />
        </Field>
        <Field label="Oportunidade">
          <select name="dealId" className="input" defaultValue={defaultDealId ?? ""}>
            <option value="">—</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="1ª parcela — vencimento (ao confirmar a venda)">
        <input name="firstDueDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="input md:w-60" />
      </Field>
      <Field label="Observações">
        <textarea name="notes" rows={2} className="input" />
      </Field>
      <div className="flex items-center justify-between rounded-xl bg-brand-50 p-4">
        <div className="text-sm text-muted">
          Subtotal {money(subtotal)}
          {discountCents > 0 && ` · desconto ${money(discountCents)}`}
        </div>
        <div className="font-display text-2xl font-bold">{money(total)}</div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirm" value="1" defaultChecked className="size-4 accent-brand-500" />
        Confirmar venda agora (gera o saldo de sessões para agendar)
      </label>
      <Submit>Salvar comanda</Submit>
    </Form>
  );
}
