import { asc, eq } from "drizzle-orm";
import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { MoneyInput } from "@/components/money-input";
import { Empty, PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { can } from "@/lib/permissions";
import { centsToInput, cn, money } from "@/lib/utils";
import { saveProcedure, toggleProcedure, toggleProgram } from "@/server/actions/catalog";
import { ProgramForm } from "./program-form";

export const metadata = { title: "Procedimentos e Programas" };

type Proc = typeof schema.procedures.$inferSelect;

function ProcedureForm({ p }: { p?: Proc }) {
  return (
    <Form action={saveProcedure.bind(null, p?.id ?? null)}>
      <Field label="Nome do procedimento">
        <input name="name" required defaultValue={p?.name} className="input" placeholder="Drenagem linfática" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Valor (R$)">
          <MoneyInput name="price" required defaultValue={p ? centsToInput(p.priceCents) : ""} />
        </Field>
        <Field label="Duração (min)">
          <input name="duration" type="number" min={5} step={5} defaultValue={p?.durationMinutes ?? 60} className="input" />
        </Field>
        <Field label="Categoria">
          <input name="category" defaultValue={p?.category ?? ""} className="input" placeholder="Corporal" list="cats" />
        </Field>
      </div>
      <datalist id="cats">
        <option value="Corporal" />
        <option value="Facial" />
        <option value="Injetáveis" />
        <option value="Avaliação" />
      </datalist>
      <Field label="Descrição">
        <textarea name="description" rows={2} defaultValue={p?.description ?? ""} className="input" />
      </Field>
      <Submit>Salvar</Submit>
    </Form>
  );
}

export default async function CatalogPage() {
  const ctx = await getContext();
  const manage = can(ctx, "catalog.manage");
  const [procedures, programs, items] = await Promise.all([
    db.select().from(schema.procedures).where(eq(schema.procedures.companyId, ctx.companyId)).orderBy(asc(schema.procedures.category), asc(schema.procedures.name)),
    db.select().from(schema.programs).where(eq(schema.programs.companyId, ctx.companyId)).orderBy(asc(schema.programs.name)),
    db
      .select({ programId: schema.programItems.programId, procedureId: schema.programItems.procedureId, sessions: schema.programItems.sessions })
      .from(schema.programItems)
      .innerJoin(schema.programs, eq(schema.programs.id, schema.programItems.programId))
      .where(eq(schema.programs.companyId, ctx.companyId)),
  ]);
  const activeProcs = procedures.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents }));

  return (
    <>
      <PageHeader title="Procedimentos e Programas" subtitle="Catálogo usado na comanda e na agenda" />

      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Programas</h2>
          {manage && (
            <Modal title="Novo programa" trigger="+ Novo programa">
              <ProgramForm procedures={activeProcs} />
            </Modal>
          )}
        </div>
        {programs.length === 0 ? (
          <Empty>Nenhum programa. Monte pacotes combinando procedimentos (ex.: 10 drenagens + 5 radiofrequências).</Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {programs.map((pg) => {
              const its = items.filter((i) => i.programId === pg.id);
              const sum = its.reduce((s, i) => s + (procedures.find((p) => p.id === i.procedureId)?.priceCents ?? 0) * i.sessions, 0);
              return (
                <div key={pg.id} className={cn("card p-5", !pg.active && "opacity-60")}>
                  <div className="flex items-start justify-between">
                    <h3 className="text-lg font-semibold">{pg.name}</h3>
                    <span className="font-display text-xl font-bold text-brand-600">{money(pg.priceCents)}</span>
                  </div>
                  {pg.description && <p className="mt-1 text-sm text-muted">{pg.description}</p>}
                  <ul className="mt-3 space-y-1 text-sm">
                    {its.map((i) => (
                      <li key={i.procedureId} className="flex justify-between">
                        <span>{procedures.find((p) => p.id === i.procedureId)?.name}</span>
                        <span className="font-medium">{i.sessions}x</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 text-xs text-muted">
                    {sum > pg.priceCents && `Economia de ${money(sum - pg.priceCents)} sobre o avulso · `}
                    {pg.validityDays ? `Validade ${pg.validityDays} dias` : "Sem validade"}
                  </div>
                  {manage && (
                    <div className="mt-4 flex gap-2">
                      <Modal title="Editar programa" trigger="Editar" triggerClassName="btn-secondary px-3 py-1.5 text-xs">
                        <ProgramForm procedures={activeProcs} initial={{ ...pg, items: its.map(({ procedureId, sessions }) => ({ procedureId, sessions })) }} />
                      </Modal>
                      <form action={toggleProgram.bind(null, pg.id, !pg.active)}>
                        <button className="btn-ghost px-3 py-1.5 text-xs">{pg.active ? "Desativar" : "Ativar"}</button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Procedimentos</h2>
          {manage && (
            <Modal title="Novo procedimento" trigger="+ Novo procedimento">
              <ProcedureForm />
            </Modal>
          )}
        </div>
        {procedures.length === 0 ? (
          <Empty>Nenhum procedimento cadastrado.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Procedimento</th>
                  <th>Categoria</th>
                  <th className="text-right">Valor</th>
                  <th className="text-right">Duração</th>
                  <th>Status</th>
                  {manage && <th />}
                </tr>
              </thead>
              <tbody>
                {procedures.map((p) => (
                  <tr key={p.id} className={cn(!p.active && "opacity-50")}>
                    <td className="font-medium">{p.name}</td>
                    <td className="text-muted">{p.category ?? "—"}</td>
                    <td className="text-right">{money(p.priceCents)}</td>
                    <td className="text-right">{p.durationMinutes} min</td>
                    <td>{p.active ? "Ativo" : "Inativo"}</td>
                    {manage && (
                      <td>
                        <div className="flex justify-end gap-2">
                          <Modal title="Editar procedimento" trigger="Editar" triggerClassName="btn-ghost px-2 py-1 text-xs">
                            <ProcedureForm p={p} />
                          </Modal>
                          <form action={toggleProcedure.bind(null, p.id, !p.active)}>
                            <button className="btn-ghost px-2 py-1 text-xs">{p.active ? "Desativar" : "Ativar"}</button>
                          </form>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
