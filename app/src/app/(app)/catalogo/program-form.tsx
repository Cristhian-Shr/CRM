"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Field, Form, Submit } from "@/components/form";
import { MoneyInput } from "@/components/money-input";
import { centsToInput, money } from "@/lib/utils";
import { saveProgram } from "@/server/actions/catalog";

type Proc = { id: string; name: string; priceCents: number };
type Initial = { id: string; name: string; description: string | null; priceCents: number; validityDays: number | null; items: { procedureId: string; sessions: number }[] };

export function ProgramForm({ procedures, initial }: { procedures: Proc[]; initial?: Initial }) {
  const [items, setItems] = useState(initial?.items ?? []);
  const sum = items.reduce((s, i) => s + (procedures.find((p) => p.id === i.procedureId)?.priceCents ?? 0) * i.sessions, 0);

  return (
    <Form action={saveProgram.bind(null, initial?.id ?? null)} onSuccess={() => !initial && setItems([])}>
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <Field label="Nome do programa">
        <input name="name" required defaultValue={initial?.name} className="input" placeholder="Programa Corpo Verão" />
      </Field>
      <Field label="Descrição">
        <textarea name="description" rows={2} defaultValue={initial?.description ?? ""} className="input" />
      </Field>
      <div>
        <span className="label">Procedimentos do programa</span>
        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={idx} className="flex gap-2">
              <select
                className="input flex-1"
                value={it.procedureId}
                onChange={(e) => setItems((p) => p.map((x, i) => (i === idx ? { ...x, procedureId: e.target.value } : x)))}
              >
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({money(p.priceCents)})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                className="input w-24"
                value={it.sessions}
                onChange={(e) => setItems((p) => p.map((x, i) => (i === idx ? { ...x, sessions: Math.max(1, Number(e.target.value)) } : x)))}
                aria-label="Sessões"
              />
              <button type="button" className="btn-ghost p-2" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} aria-label="Remover">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={!procedures.length}
            onClick={() => setItems((p) => [...p, { procedureId: procedures[0].id, sessions: 1 }])}
          >
            + Adicionar procedimento
          </button>
          {!procedures.length && <p className="text-xs text-amber-700">Cadastre procedimentos primeiro.</p>}
        </div>
        {items.length > 0 && <p className="mt-2 text-xs text-muted">Soma avulsa das sessões: {money(sum)}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor do programa (R$)">
          <MoneyInput name="price" required defaultValue={initial ? centsToInput(initial.priceCents) : ""} />
        </Field>
        <Field label="Validade (dias)">
          <input name="validityDays" type="number" min={1} defaultValue={initial?.validityDays ?? ""} className="input" placeholder="120" />
        </Field>
      </div>
      <Submit>{initial ? "Salvar programa" : "Criar programa"}</Submit>
    </Form>
  );
}
