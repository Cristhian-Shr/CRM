"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Field, Form, Submit } from "@/components/form";
import { maskMoney } from "@/components/money-input";
import { PAYMENT_METHODS } from "@/lib/payments";
import { cn, money, parseMoney } from "@/lib/utils";
import { saveQuote } from "@/server/actions/quotes";

type Cat = { id: string; name: string; priceCents: number };
type Opt = { id: string; name: string };
type RawItem = { type: "procedure" | "program"; id: string; quantity: number; discount: number };
type DiscMode = "value" | "percent";
type Line = {
  type: "procedure" | "program";
  id: string;
  name: string;
  unit: number;
  quantity: number;
  discount: string;
  discountMode: DiscMode;
};

/** Desconto da linha em centavos, por valor (R$) ou porcentagem. */
function lineDiscountCents(l: Line) {
  const max = l.unit * l.quantity;
  if (l.discountMode === "percent") {
    const pct = Number((l.discount || "").replace(",", ".")) || 0;
    return Math.min(max, Math.max(0, Math.round((max * pct) / 100)));
  }
  return Math.min(parseMoney(l.discount), max);
}

export function QuoteBuilder({
  quoteId = null,
  contacts,
  members,
  procedures,
  programs,
  initial,
}: {
  quoteId?: string | null;
  contacts: Opt[];
  members: Opt[];
  procedures: Cat[];
  programs: Cat[];
  initial?: {
    contactId: string;
    sellerId: string | null;
    validUntil: string | null;
    paymentMethod: string | null;
    installments: number | null;
    entryCents: number;
    notes: string | null;
    items: RawItem[];
  };
}) {
  const [lines, setLines] = useState<Line[]>(() =>
    (initial?.items ?? []).map((i) => {
      const src = i.type === "program" ? programs.find((p) => p.id === i.id) : procedures.find((p) => p.id === i.id);
      return {
        type: i.type,
        id: i.id,
        name: src?.name ?? "—",
        unit: src?.priceCents ?? 0,
        quantity: i.quantity,
        discount: i.discount ? maskMoney(String(i.discount)) : "",
        discountMode: "value" as DiscMode,
      };
    }),
  );
  const [entry, setEntry] = useState(initial && initial.entryCents ? maskMoney(String(initial.entryCents)) : "");
  const [installments, setInstallments] = useState(initial?.installments ?? 1);

  const lineTotal = (l: Line) => Math.max(0, l.unit * l.quantity - lineDiscountCents(l));
  const subtotal = lines.reduce((s, l) => s + l.unit * l.quantity, 0);
  const discount = lines.reduce((s, l) => s + lineDiscountCents(l), 0);
  const total = Math.max(0, subtotal - discount);
  const entryCents = Math.min(parseMoney(entry), total);
  const remaining = Math.max(0, total - entryCents);
  const parcela = installments > 0 ? remaining / installments : remaining;

  const itemsJson = JSON.stringify(
    lines.map((l) => ({ type: l.type, id: l.id, quantity: l.quantity, discount: lineDiscountCents(l) })),
  );

  function add(value: string) {
    if (!value) return;
    const [type, id] = value.split(":") as ["procedure" | "program", string];
    const src = type === "program" ? programs.find((p) => p.id === id) : procedures.find((p) => p.id === id);
    if (!src) return;
    setLines((prev) =>
      prev.some((l) => l.id === id)
        ? prev.map((l) => (l.id === id ? { ...l, quantity: l.quantity + 1 } : l))
        : [...prev, { type, id, name: src.name, unit: src.priceCents, quantity: 1, discount: "", discountMode: "value" }],
    );
  }
  const patch = (id: string, p: Partial<Line>) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const remove = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));

  return (
    <Form action={saveQuote.bind(null, quoteId)} resetOnSuccess={false}>
      <input type="hidden" name="items" value={itemsJson} />

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Cliente">
          <select name="contactId" required defaultValue={initial?.contactId ?? ""} className="input">
            <option value="" disabled>
              Selecione...
            </option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vendedor">
          <select name="sellerId" defaultValue={initial?.sellerId ?? ""} className="input">
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Validade">
          <input name="validUntil" type="date" defaultValue={initial?.validUntil ?? ""} className="input" />
        </Field>
        <Field label="Pagamento">
          <select name="paymentMethod" defaultValue={initial?.paymentMethod ?? "pix"} className="input">
            {PAYMENT_METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Parcelamento">
          <input
            name="installments"
            type="number"
            min={1}
            max={24}
            value={installments}
            onChange={(e) => setInstallments(Math.max(1, Number(e.target.value) || 1))}
            className="input"
          />
        </Field>
      </div>

      <Field label="Adicionar item (plano ou serviço)">
        <select className="input" value="" onChange={(e) => add(e.target.value)}>
          <option value="">Selecione...</option>
          <optgroup label="Planos">
            {programs.map((p) => (
              <option key={p.id} value={`program:${p.id}`}>
                {p.name} · {money(p.priceCents)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Serviços">
            {procedures.map((p) => (
              <option key={p.id} value={`procedure:${p.id}`}>
                {p.name} · {money(p.priceCents)}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>

      {lines.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="w-20 text-center">Qtd</th>
                <th className="text-right">Unitário</th>
                <th className="w-28 text-right">Desconto</th>
                <th className="text-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium">{l.name}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) => patch(l.id, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                      className="input py-1 text-center"
                    />
                  </td>
                  <td className="text-right">{money(l.unit)}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <input
                        inputMode="numeric"
                        placeholder={l.discountMode === "percent" ? "0" : "0,00"}
                        value={l.discount}
                        onChange={(e) => patch(l.id, { discount: l.discountMode === "value" ? maskMoney(e.target.value) : e.target.value })}
                        className="input w-20 py-1 text-right"
                      />
                      <div className="flex overflow-hidden rounded-lg border border-line text-xs">
                        <button
                          type="button"
                          onClick={() => patch(l.id, { discountMode: "value", discount: "" })}
                          className={cn("px-2 py-1", l.discountMode === "value" ? "bg-brand-500 text-white" : "text-muted")}
                        >
                          R$
                        </button>
                        <button
                          type="button"
                          onClick={() => patch(l.id, { discountMode: "percent", discount: "" })}
                          className={cn("px-2 py-1", l.discountMode === "percent" ? "bg-brand-500 text-white" : "text-muted")}
                        >
                          %
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="text-right font-medium">{money(lineTotal(l))}</td>
                  <td className="text-right">
                    <button type="button" onClick={() => remove(l.id)} className="btn-ghost p-1.5 text-red-600" aria-label="Remover">
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Valor de entrada (R$)">
          <input inputMode="numeric" placeholder="0,00" value={entry} onChange={(e) => setEntry(maskMoney(e.target.value))} className="input" />
        </Field>
        <Field label="Observações">
          <input name="notes" defaultValue={initial?.notes ?? ""} className="input" />
        </Field>
      </div>
      <input type="hidden" name="entry" value={entry} />

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-brand-50 p-4 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-muted">Subtotal</div>
          <div className="font-semibold">{money(subtotal)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Desconto</div>
          <div className="font-semibold text-red-600">{money(discount)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Total</div>
          <div className="font-display text-lg font-bold">{money(total)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">
            Restante em {installments}x de {money(parcela)}
          </div>
          <div className="font-semibold">{money(remaining)}</div>
        </div>
      </div>

      <Submit>Salvar orçamento</Submit>
    </Form>
  );
}
