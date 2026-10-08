import { asc, desc, eq } from "drizzle-orm";
import { ArrowDown, ArrowUp } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { listStages } from "@/lib/db/tenant";
import { cn, money, todayISO } from "@/lib/utils";
import {
  addLossReason,
  addRoom,
  addSource,
  addStage,
  deleteStage,
  moveStage,
  saveCompany,
  saveGoal,
  toggleRoom,
  toggleSource,
  updateStage,
} from "@/server/actions/settings";

export const metadata = { title: "Configurações" };

const KIND = { open: "Aberta", won: "Ganho", lost: "Perdido" } as Record<string, string>;
const METRIC: Record<string, string> = { revenue: "Faturamento", deals_won: "Vendas fechadas", appointments: "Agendamentos", leads: "Leads" };

export default async function SettingsPage() {
  const ctx = await getContext();
  const cid = ctx.companyId;
  const [company, stages, sources, reasons, rooms, goals] = await Promise.all([
    db.query.companies.findFirst({ where: eq(schema.companies.id, cid) }),
    listStages(cid),
    db.select().from(schema.leadSources).where(eq(schema.leadSources.companyId, cid)).orderBy(asc(schema.leadSources.name)),
    db.select().from(schema.lossReasons).where(eq(schema.lossReasons.companyId, cid)).orderBy(asc(schema.lossReasons.name)),
    db.select().from(schema.rooms).where(eq(schema.rooms.companyId, cid)).orderBy(asc(schema.rooms.name)),
    db.select().from(schema.goals).where(eq(schema.goals.companyId, cid)).orderBy(desc(schema.goals.startsOn)).limit(12),
  ]);
  if (!company) return null;

  return (
    <>
      <PageHeader title="Configurações" subtitle="Dados da clínica, funil, origens, salas e metas" />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Clínica</h2>
          <Form action={saveCompany} resetOnSuccess={false}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome">
                <input name="name" defaultValue={company.name} required className="input" />
              </Field>
              <Field label="Razão social">
                <input name="legalName" defaultValue={company.legalName ?? ""} className="input" />
              </Field>
              <Field label="CNPJ">
                <input name="cnpj" defaultValue={company.cnpj ?? ""} className="input" />
              </Field>
              <Field label="Telefone">
                <input name="phone" defaultValue={company.phone ?? ""} className="input" />
              </Field>
              <Field label="E-mail">
                <input name="email" defaultValue={company.email ?? ""} className="input" />
              </Field>
              <Field label="Desconto máximo do colaborador (%)">
                <input name="maxDiscountPercent" type="number" min={0} max={100} defaultValue={company.settings.maxDiscountPercent ?? 100} className="input" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="collaboratorsSeeAllLeads" defaultChecked={!!company.settings.collaboratorsSeeAllLeads} className="accent-brand-500" />
              Colaboradores veem todos os leads (desligado: cada um vê só os seus)
            </label>
            <Submit>Salvar</Submit>
          </Form>
        </section>

        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Etapas do funil</h2>
            <Modal title="Nova etapa" trigger="+ Etapa" triggerClassName="btn-secondary px-3 py-1.5 text-xs">
              <Form action={addStage}>
                <Field label="Nome">
                  <input name="name" required className="input" placeholder="Agendamento" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Tipo">
                    <select name="kind" className="input">
                      <option value="open">Aberta</option>
                      <option value="won">Ganho</option>
                      <option value="lost">Perdido</option>
                    </select>
                  </Field>
                  <Field label="Cor">
                    <input name="color" type="color" defaultValue="#6366f1" className="input h-10 p-1" />
                  </Field>
                </div>
                <Submit>Adicionar</Submit>
              </Form>
            </Modal>
          </div>
          <div className="space-y-2">
            {stages.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2 rounded-xl border border-line p-2">
                <Form action={updateStage.bind(null, s.id)} resetOnSuccess={false} className="flex flex-1 items-center gap-2 space-y-0">
                  <input type="color" name="color" defaultValue={s.color} className="size-8 shrink-0 cursor-pointer rounded border-0 bg-transparent" />
                  <input name="name" defaultValue={s.name} className="input py-1.5" />
                  <span className="badge shrink-0 bg-canvas text-muted">{KIND[s.kind]}</span>
                  <Submit className="btn-ghost px-2 py-1 text-xs">Salvar</Submit>
                </Form>
                <form action={moveStage.bind(null, s.id, -1)}>
                  <button className="btn-ghost p-1.5" disabled={i === 0} aria-label="Subir">
                    <ArrowUp className="size-4" />
                  </button>
                </form>
                <form action={moveStage.bind(null, s.id, 1)}>
                  <button className="btn-ghost p-1.5" disabled={i === stages.length - 1} aria-label="Descer">
                    <ArrowDown className="size-4" />
                  </button>
                </form>
                <ActionButton action={deleteStage.bind(null, s.id)} className="btn-ghost px-2 py-1 text-xs text-red-600" confirm="Excluir esta etapa?">
                  Excluir
                </ActionButton>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Origens dos leads</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {sources.map((s) => (
              <form key={s.id} action={toggleSource.bind(null, s.id, !s.active)}>
                <button className={cn("badge border border-line px-3 py-1", s.active ? "bg-surface" : "bg-canvas text-muted line-through")} title={s.active ? "Desativar" : "Ativar"}>
                  {s.name}
                </button>
              </form>
            ))}
          </div>
          <Form action={addSource} className="flex gap-2 space-y-0">
            <input name="name" required placeholder="Nova origem" className="input" />
            <select name="type" className="input w-40">
              <option value="paid_ad">Anúncio pago</option>
              <option value="organic">Orgânico</option>
              <option value="referral">Indicação</option>
              <option value="partnership">Parceria</option>
              <option value="website">Site</option>
              <option value="other">Outro</option>
            </select>
            <Submit className="btn-secondary">Adicionar</Submit>
          </Form>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Motivos de perda</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {reasons.map((r) => (
              <span key={r.id} className="badge border border-line bg-surface px-3 py-1">
                {r.name}
              </span>
            ))}
          </div>
          <Form action={addLossReason} className="flex gap-2 space-y-0">
            <input name="name" required placeholder="Novo motivo" className="input" />
            <Submit className="btn-secondary">Adicionar</Submit>
          </Form>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Salas da agenda</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {rooms.map((r) => (
              <form key={r.id} action={toggleRoom.bind(null, r.id, !r.active)}>
                <button className={cn("badge border border-line px-3 py-1", r.active ? "bg-surface" : "bg-canvas text-muted line-through")} title={r.active ? "Desativar" : "Ativar"}>
                  {r.name}
                </button>
              </form>
            ))}
          </div>
          <Form action={addRoom} className="flex gap-2 space-y-0">
            <input name="name" required placeholder="Estética 3" className="input" />
            <Submit className="btn-secondary">Adicionar</Submit>
          </Form>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Metas</h2>
          <Form action={saveGoal} className="mb-4 grid grid-cols-2 gap-3 space-y-0 md:grid-cols-4">
            <select name="metric" className="input">
              {Object.entries(METRIC).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input name="month" type="month" defaultValue={todayISO().slice(0, 7)} className="input" />
            <input name="target" required placeholder="Valor" className="input" inputMode="decimal" />
            <Submit className="btn-secondary">Definir meta</Submit>
          </Form>
          <table className="table">
            <tbody>
              {goals.map((g) => (
                <tr key={g.id}>
                  <td>{METRIC[g.metric]}</td>
                  <td>a partir de {g.startsOn.slice(5, 7)}/{g.startsOn.slice(0, 4)}</td>
                  <td className="text-right font-semibold">{g.metric === "revenue" ? money(g.target) : g.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">A meta de faturamento aparece como barra de progresso na Visão Geral.</p>
        </section>
      </div>
    </>
  );
}
