import { and, asc, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { Pencil } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { AutoSubmitInput, AutoSubmitSelect } from "@/components/auto-submit";
import { Modal } from "@/components/modal";
import { Empty, PageHeader } from "@/components/ui";
import { QuoteBuilder } from "@/components/quotes/quote-builder";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { listMembers } from "@/lib/db/tenant";
import { fmtDate, money, monthLabel, monthRange, todayISO, ucfirst } from "@/lib/utils";
import { convertQuoteToOrder, deleteQuote, reopenQuote } from "@/server/actions/quotes";

export const metadata = { title: "Orçamentos" };

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Aberto", cls: "bg-indigo-50 text-indigo-700" },
  approved: { label: "Aprovado", cls: "bg-green-50 text-green-700" },
  rejected: { label: "Recusado", cls: "bg-red-50 text-red-700" },
  converted: { label: "Convertido", cls: "bg-brand-100 text-brand-700" },
};

export default async function OrcamentosPage({ searchParams }: { searchParams: Promise<{ mes?: string; status?: string }> }) {
  const ctx = await getContext();
  const { mes, status } = await searchParams;
  const month = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : todayISO().slice(0, 7);
  const { start, end } = monthRange(month);

  const { quotes, quoteItems, contacts } = schema;
  const where = [eq(quotes.companyId, ctx.companyId), gte(quotes.createdAt, start), lt(quotes.createdAt, end)];
  if (status && STATUS[status]) where.push(eq(quotes.status, status));

  const rows = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      createdAt: quotes.createdAt,
      status: quotes.status,
      totalCents: quotes.totalCents,
      contactName: contacts.name,
      sellerName: schema.users.name,
      contactId: quotes.contactId,
      sellerId: quotes.sellerId,
      validUntil: quotes.validUntil,
      paymentMethod: quotes.paymentMethod,
      installments: quotes.installments,
      entryCents: quotes.entryCents,
      notes: quotes.notes,
    })
    .from(quotes)
    .innerJoin(contacts, eq(contacts.id, quotes.contactId))
    .leftJoin(schema.companyMembers, eq(schema.companyMembers.id, quotes.sellerId))
    .leftJoin(schema.users, eq(schema.users.id, schema.companyMembers.userId))
    .where(and(...where))
    .orderBy(desc(quotes.createdAt));

  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select({
          quoteId: quoteItems.quoteId,
          itemType: quoteItems.itemType,
          procedureId: quoteItems.procedureId,
          programId: quoteItems.programId,
          quantity: quoteItems.quantity,
          discountCents: quoteItems.discountCents,
        })
        .from(quoteItems)
        .where(inArray(quoteItems.quoteId, ids))
    : [];
  const itemsByQuote = new Map<string, { type: "procedure" | "program"; id: string; quantity: number; discount: number }[]>();
  for (const it of items) {
    const list = itemsByQuote.get(it.quoteId) ?? [];
    list.push({
      type: it.itemType as "procedure" | "program",
      id: (it.procedureId ?? it.programId)!,
      quantity: it.quantity,
      discount: it.discountCents,
    });
    itemsByQuote.set(it.quoteId, list);
  }

  // Dados para o construtor.
  const clientes = await db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(and(eq(contacts.companyId, ctx.companyId), isNull(contacts.deletedAt)))
    .orderBy(asc(contacts.name))
    .limit(500);
  const members = (await listMembers(ctx.companyId)).filter((m) => m.active).map((m) => ({ id: m.id, name: m.name }));
  const procs = await db
    .select({ id: schema.procedures.id, name: schema.procedures.name, priceCents: schema.procedures.priceCents })
    .from(schema.procedures)
    .where(and(eq(schema.procedures.companyId, ctx.companyId), eq(schema.procedures.active, true)))
    .orderBy(asc(schema.procedures.name));
  const progs = await db
    .select({ id: schema.programs.id, name: schema.programs.name, priceCents: schema.programs.priceCents })
    .from(schema.programs)
    .where(and(eq(schema.programs.companyId, ctx.companyId), eq(schema.programs.active, true)))
    .orderBy(asc(schema.programs.name));

  const builderProps = { contacts: clientes, members, procedures: procs, programs: progs };

  return (
    <>
      <PageHeader
        title="Orçamentos"
        subtitle={<span>Propostas · {ucfirst(monthLabel(month))}</span>}
        actions={
          <div className="flex items-center gap-2">
            <form className="flex items-center gap-2">
              <AutoSubmitInput type="month" name="mes" defaultValue={month} className="input w-44" />
              <AutoSubmitSelect name="status" defaultValue={status ?? ""} className="input w-40">
                <option value="">Todos os status</option>
                <option value="open">Aberto</option>
                <option value="approved">Aprovado</option>
                <option value="rejected">Recusado</option>
                <option value="converted">Convertido</option>
              </AutoSubmitSelect>
            </form>
            <Modal title="Cadastro de orçamento" trigger="+ Adicionar" wide>
              <QuoteBuilder {...builderProps} />
            </Modal>
          </div>
        }
      />

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Data</th>
              <th>Cliente</th>
              <th>Vendedor</th>
              <th>Valor</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => {
              const s = STATUS[q.status] ?? STATUS.open;
              return (
                <tr key={q.id}>
                  <td className="font-medium">#{q.number}</td>
                  <td>{fmtDate(q.createdAt)}</td>
                  <td>{q.contactName}</td>
                  <td className="text-muted">{q.sellerName ?? "—"}</td>
                  <td className="font-medium">{money(q.totalCents)}</td>
                  <td>
                    <span className={`badge ${s.cls}`}>{s.label}</span>
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Modal
                        title={`Orçamento #${q.number}${q.status === "converted" ? " · convertido" : ""}`}
                        trigger={
                          <>
                            <Pencil className="size-3.5" /> Editar
                          </>
                        }
                        triggerClassName="btn-ghost text-xs"
                        wide
                      >
                        {q.status === "converted" && (
                          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                            Este orçamento já virou comanda. As alterações atualizam a comanda apenas se ela ainda estiver em rascunho
                            (não confirmada).
                          </p>
                        )}
                        <QuoteBuilder
                          {...builderProps}
                          quoteId={q.id}
                          initial={{
                            contactId: q.contactId,
                            sellerId: q.sellerId,
                            validUntil: q.validUntil,
                            paymentMethod: q.paymentMethod,
                            installments: q.installments,
                            entryCents: q.entryCents,
                            notes: q.notes,
                            items: itemsByQuote.get(q.id) ?? [],
                          }}
                        />
                      </Modal>
                      {q.status !== "converted" && (
                        <ActionButton action={convertQuoteToOrder.bind(null, q.id)} className="btn-secondary text-xs">
                          Gerar comanda
                        </ActionButton>
                      )}
                      {q.status === "converted" && (
                        <ActionButton
                          action={reopenQuote.bind(null, q.id)}
                          className="btn-ghost text-xs"
                          confirm="Estornar este orçamento? A comanda gerada (se ainda em rascunho) será removida e o orçamento volta para Aberto."
                        >
                          Reabrir
                        </ActionButton>
                      )}
                      <ActionButton
                        action={deleteQuote.bind(null, q.id)}
                        className="btn-ghost text-xs text-red-600 hover:text-red-700"
                        confirm="Excluir este orçamento?"
                      >
                        Excluir
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-4">
            <Empty>Nenhum orçamento em {ucfirst(monthLabel(month))}. Clique em “+ Adicionar” para criar.</Empty>
          </div>
        )}
      </div>
    </>
  );
}
