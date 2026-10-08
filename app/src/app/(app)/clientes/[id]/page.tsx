import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { notFound } from "next/navigation";
import { AppointmentForm } from "@/components/agenda/appointment-form";
import { Chat, type ChatMessage } from "@/components/client/chat";
import { OrderBuilder } from "@/components/client/order-builder";
import { Tabs } from "@/components/client/tabs";
import { Timeline } from "@/components/client/timeline";
import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { MoneyInput } from "@/components/money-input";
import { PhoneInput } from "@/components/phone-input";
import { TaskForm } from "@/components/tasks/task-form";
import { Avatar, StatusBadge } from "@/components/ui";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/agenda";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { contactScope, listStages } from "@/lib/db/tenant";
import { can } from "@/lib/permissions";
import { cn, fmtDate, fmtDateTime, fmtPhone, money, todayISO } from "@/lib/utils";
import { addNote, createDeal, updateContact } from "@/server/actions/leads";
import { cancelOrder, confirmOrder } from "@/server/actions/orders";
import { setTaskStatus } from "@/server/actions/tasks";
import { agendaOptions } from "@/server/options";
import { DeleteContact, OrderActions } from "./actions";

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ comanda?: string }> }) {
  const ctx = await getContext();
  const { id } = await params;
  const { comanda } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const contact = await db.query.contacts.findFirst({ where: and(contactScope(ctx), eq(schema.contacts.id, id)) });
  if (!contact) notFound();

  const [stages, sources, deals, activities, convs, orders, procedures, programs, programItems, appts, tasks, waAccount, opts] = await Promise.all([
    listStages(ctx.companyId),
    db.select().from(schema.leadSources).where(eq(schema.leadSources.companyId, ctx.companyId)),
    db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.companyId, ctx.companyId), eq(schema.deals.contactId, id)))
      .orderBy(desc(schema.deals.createdAt)),
    db
      .select({
        id: schema.activities.id,
        type: schema.activities.type,
        payload: schema.activities.payload,
        createdAt: schema.activities.createdAt,
        actor: schema.users.name,
      })
      .from(schema.activities)
      .leftJoin(schema.users, eq(schema.users.id, schema.activities.actorId))
      .where(and(eq(schema.activities.companyId, ctx.companyId), eq(schema.activities.contactId, id)))
      .orderBy(desc(schema.activities.createdAt))
      .limit(200),
    db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(and(eq(schema.conversations.companyId, ctx.companyId), eq(schema.conversations.contactId, id))),
    db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.companyId, ctx.companyId), eq(schema.orders.contactId, id)))
      .orderBy(desc(schema.orders.createdAt)),
    db
      .select()
      .from(schema.procedures)
      .where(and(eq(schema.procedures.companyId, ctx.companyId), eq(schema.procedures.active, true)))
      .orderBy(asc(schema.procedures.name)),
    db
      .select()
      .from(schema.programs)
      .where(and(eq(schema.programs.companyId, ctx.companyId), eq(schema.programs.active, true)))
      .orderBy(asc(schema.programs.name)),
    db
      .select({ programId: schema.programItems.programId, sessions: schema.programItems.sessions, name: schema.procedures.name })
      .from(schema.programItems)
      .innerJoin(schema.procedures, eq(schema.procedures.id, schema.programItems.procedureId))
      .where(eq(schema.procedures.companyId, ctx.companyId)),
    db
      .select({
        id: schema.appointments.id,
        startsAt: schema.appointments.startsAt,
        status: schema.appointments.status,
        procedure: schema.procedures.name,
        room: schema.rooms.name,
      })
      .from(schema.appointments)
      .leftJoin(schema.procedures, eq(schema.procedures.id, schema.appointments.procedureId))
      .leftJoin(schema.rooms, eq(schema.rooms.id, schema.appointments.roomId))
      .where(and(eq(schema.appointments.companyId, ctx.companyId), eq(schema.appointments.contactId, id), gte(schema.appointments.startsAt, new Date(Date.now() - 90 * 86_400_000))))
      .orderBy(desc(schema.appointments.startsAt))
      .limit(20),
    db
      .select({ id: schema.tasks.id, title: schema.tasks.title, dueAt: schema.tasks.dueAt, assignee: schema.users.name })
      .from(schema.tasks)
      .innerJoin(schema.companyMembers, eq(schema.companyMembers.id, schema.tasks.assignedTo))
      .innerJoin(schema.users, eq(schema.users.id, schema.companyMembers.userId))
      .where(and(eq(schema.tasks.companyId, ctx.companyId), eq(schema.tasks.contactId, id), eq(schema.tasks.status, "pending")))
      .orderBy(asc(schema.tasks.dueAt)),
    db.query.whatsappAccounts.findFirst({
      where: and(eq(schema.whatsappAccounts.companyId, ctx.companyId), eq(schema.whatsappAccounts.status, "connected")),
    }),
    agendaOptions(ctx, id),
  ]);

  const msgs = convs.length
    ? await db
        .select({
          id: schema.messages.id,
          direction: schema.messages.direction,
          senderType: schema.messages.senderType,
          type: schema.messages.type,
          body: schema.messages.body,
          status: schema.messages.status,
          sentAt: schema.messages.sentAt,
          senderName: schema.users.name,
        })
        .from(schema.messages)
        .leftJoin(schema.users, eq(schema.users.id, schema.messages.senderUserId))
        .where(inArray(schema.messages.conversationId, convs.map((c) => c.id)))
        .orderBy(asc(schema.messages.sentAt))
        .limit(500)
    : [];

  const allSessions = await db
    .select({
      id: schema.contractedSessions.id,
      total: schema.contractedSessions.sessionsTotal,
      used: schema.contractedSessions.sessionsUsed,
      expiresAt: schema.contractedSessions.expiresAt,
      procedure: schema.procedures.name,
      program: schema.programs.name,
    })
    .from(schema.contractedSessions)
    .innerJoin(schema.procedures, eq(schema.procedures.id, schema.contractedSessions.procedureId))
    .leftJoin(schema.programs, eq(schema.programs.id, schema.contractedSessions.programId))
    .where(and(eq(schema.contractedSessions.companyId, ctx.companyId), eq(schema.contractedSessions.contactId, id)))
    .orderBy(asc(schema.contractedSessions.expiresAt), asc(schema.procedures.name));

  const items = orders.length
    ? await db.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, orders.map((o) => o.id)))
    : [];

  const owner = opts.members.find((m) => m.id === contact.ownerId);
  const source = sources.find((s) => s.id === contact.sourceId);
  const stageName = (sid: string) => stages.find((s) => s.id === sid);
  const openDeals = deals.filter((d) => !d.deletedAt);
  const chatMessages: ChatMessage[] = msgs.map((m) => ({ ...m, sentAt: m.sentAt.toISOString() }));

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_1fr_360px]">
      {/* Esquerda: dados */}
      <div className="space-y-4">
        <div className="card p-5">
          <div className="flex items-start gap-3">
            <Avatar name={contact.name} />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl leading-tight font-semibold">{contact.name}</h1>
              <div className="mt-1 flex flex-wrap gap-1">
                <StatusBadge status={contact.status} />
                {contact.tags.map((t) => (
                  <span key={t} className="badge bg-brand-50 text-brand-700">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            {contact.phone && (
              <div className="flex items-center gap-2">
                <Phone className="size-4 text-muted" /> {fmtPhone(contact.phone)}
                <a
                  href={`https://wa.me/${(contact.whatsapp ?? contact.phone).replace(/\D/g, "")}`}
                  target="_blank"
                  className="ml-auto text-green-600"
                  title="Abrir WhatsApp"
                >
                  <MessageCircle className="size-4" />
                </a>
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-2">
                <Mail className="size-4 text-muted" /> {contact.email}
              </div>
            )}
            <Row label="Empresa" value={contact.companyName} />
            <Row label="Responsável" value={owner?.name} />
            <Row label="Origem" value={source?.name} />
            <Row label="Nascimento" value={contact.birthDate ? fmtDate(contact.birthDate + "T12:00:00Z") : null} />
            <Row label="Cadastro" value={fmtDate(contact.createdAt)} />
            <Row label="Consentimento LGPD" value={contact.consentAt ? fmtDate(contact.consentAt) : "Não registrado"} />
          </dl>
          {contact.notes && <p className="mt-3 rounded-xl bg-canvas p-3 text-sm whitespace-pre-wrap">{contact.notes}</p>}
          <div className="mt-4 flex gap-2">
            <Modal title="Editar ficha" trigger="Editar" triggerClassName="btn-secondary flex-1">
              <Form action={updateContact.bind(null, id)} resetOnSuccess={false}>
                <Field label="Nome">
                  <input name="name" required defaultValue={contact.name} className="input" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Telefone">
                    <PhoneInput name="phone" defaultValue={fmtPhone(contact.phone)} />
                  </Field>
                  <Field label="WhatsApp (se diferente)">
                    <PhoneInput name="whatsapp" defaultValue={contact.whatsapp !== contact.phone ? fmtPhone(contact.whatsapp) : ""} />
                  </Field>
                  <Field label="E-mail">
                    <input name="email" type="email" defaultValue={contact.email ?? ""} className="input" />
                  </Field>
                  <Field label="Empresa">
                    <input name="companyName" defaultValue={contact.companyName ?? ""} className="input" />
                  </Field>
                  <Field label="CPF">
                    <input name="cpf" defaultValue={contact.cpf ?? ""} className="input" />
                  </Field>
                  <Field label="Nascimento">
                    <input name="birthDate" type="date" defaultValue={contact.birthDate ?? ""} className="input" />
                  </Field>
                  <Field label="Status">
                    <select name="status" defaultValue={contact.status} className="input">
                      <option value="lead">Lead</option>
                      <option value="client">Cliente</option>
                      <option value="inactive">Inativo</option>
                    </select>
                  </Field>
                  <Field label="Responsável">
                    <select name="ownerId" defaultValue={contact.ownerId ?? ""} className="input">
                      <option value="">—</option>
                      {opts.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Origem">
                    <select name="sourceId" defaultValue={contact.sourceId ?? ""} className="input">
                      <option value="">—</option>
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Tags (separadas por vírgula)">
                    <input name="tags" defaultValue={contact.tags.join(", ")} className="input" />
                  </Field>
                </div>
                <Field label="Observações">
                  <textarea name="notes" rows={3} defaultValue={contact.notes ?? ""} className="input" />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="consent" defaultChecked={!!contact.consentAt} className="accent-brand-500" />
                  Cliente autorizou contato (LGPD)
                </label>
                <Submit>Salvar</Submit>
              </Form>
            </Modal>
            {can(ctx, "leads.delete") && <DeleteContact id={id} />}
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Oportunidades</h2>
            <Modal title="Nova oportunidade" trigger="+ Nova" triggerClassName="btn-ghost px-2 py-1 text-xs">
              <Form action={createDeal.bind(null, id)}>
                <Field label="Título">
                  <input name="title" required className="input" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Valor (R$)">
                    <MoneyInput name="value" />
                  </Field>
                  <Field label="Etapa">
                    <select name="stageId" className="input">
                      {stages.filter((s) => s.kind === "open").map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Submit>Criar</Submit>
              </Form>
            </Modal>
          </div>
          <div className="space-y-2">
            {openDeals.map((d) => {
              const st = stageName(d.stageId);
              return (
                <div key={d.id} className="rounded-xl border border-line p-3 text-sm">
                  <div className="font-medium">{d.title}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="badge" style={{ background: `${st?.color}1a`, color: st?.color }}>
                      {st?.name}
                    </span>
                    <span className="font-semibold">{money(d.valueCents)}</span>
                  </div>
                </div>
              );
            })}
            {openDeals.length === 0 && <p className="text-sm text-muted">Nenhuma oportunidade.</p>}
          </div>
        </div>
      </div>

      {/* Centro: conversa e linha do tempo */}
      <div className="card min-w-0 p-5">
        <Tabs
          tabs={[
            {
              id: "chat",
              label: "Conversa",
              content: <Chat contactId={id} messages={chatMessages} connected={!!waAccount} />,
            },
            {
              id: "timeline",
              label: "Linha do tempo",
              content: (
                <div className="space-y-5">
                  <Form action={addNote.bind(null, id)} className="space-y-2">
                    <textarea name="text" rows={2} required placeholder="Registrar anotação ou ligação..." className="input" />
                    <div className="flex gap-2">
                      <select name="kind" className="input w-40">
                        <option value="note">Anotação</option>
                        <option value="call">Ligação</option>
                      </select>
                      <Submit className="btn-secondary">Registrar</Submit>
                    </div>
                  </Form>
                  <Timeline items={activities} />
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* Direita: comanda, sessões, agenda, tarefas */}
      <div className="space-y-4">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Comanda / Programa</h2>
            <Modal title={`Montar comanda · ${contact.name}`} trigger="Montar comanda" triggerClassName="btn-primary px-3 py-1.5 text-xs" wide defaultOpen={!!comanda}>
              <OrderBuilder
                contactId={id}
                procedures={procedures.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents }))}
                programs={programs.map((p) => ({
                  id: p.id,
                  name: p.name,
                  priceCents: p.priceCents,
                  items: programItems.filter((i) => i.programId === p.id),
                }))}
                deals={openDeals.map((d) => ({ id: d.id, title: d.title }))}
                defaultDealId={openDeals[0]?.id}
              />
            </Modal>
          </div>
          {allSessions.length > 0 && (
            <div className="mb-4 space-y-3">
              <div className="label">Saldo de sessões</div>
              {allSessions.map((s) => (
                <div key={s.id}>
                  <div className="flex justify-between text-sm">
                    <span>
                      {s.procedure}
                      {s.program && <span className="text-muted"> · {s.program}</span>}
                    </span>
                    <span className="font-semibold">
                      {s.used}/{s.total}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-brand-50">
                    <div className="h-full bg-brand-500" style={{ width: `${(s.used / s.total) * 100}%` }} />
                  </div>
                  {s.expiresAt && <div className="mt-0.5 text-[11px] text-muted">Validade {fmtDate(s.expiresAt + "T12:00:00Z")}</div>}
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {orders.map((o) => (
              <div key={o.id} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex justify-between">
                  <span className="font-semibold">{money(o.totalCents)}</span>
                  <span
                    className={cn(
                      "badge",
                      o.status === "confirmed" || o.status === "paid"
                        ? "bg-green-50 text-green-700"
                        : o.status === "cancelled"
                          ? "bg-zinc-100 text-zinc-500"
                          : "bg-amber-50 text-amber-700",
                    )}
                  >
                    {{ draft: "Rascunho", confirmed: "Confirmada", paid: "Paga", cancelled: "Cancelada" }[o.status]}
                  </span>
                </div>
                <ul className="mt-1 text-xs text-muted">
                  {items
                    .filter((i) => i.orderId === o.id)
                    .map((i) => (
                      <li key={i.id}>
                        {i.quantity}x {i.description} · {money(i.totalCents)}
                      </li>
                    ))}
                </ul>
                <div className="mt-1 text-[11px] text-muted">{fmtDate(o.createdAt)}</div>
                {o.status !== "cancelled" && <OrderActions id={o.id} draft={o.status === "draft"} confirm={confirmOrder} cancel={cancelOrder} />}
              </div>
            ))}
            {orders.length === 0 && <p className="text-sm text-muted">Nenhuma comanda ainda.</p>}
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Agendamentos</h2>
            <Modal title="Agendar atendimento" trigger="+ Agendar" triggerClassName="btn-ghost px-2 py-1 text-xs">
              <AppointmentForm
                contacts={opts.contacts}
                procedures={opts.procedures}
                professionals={opts.professionals}
                rooms={opts.rooms}
                sessions={opts.sessions}
                defaults={{ contactId: id, date: todayISO() }}
              />
            </Modal>
          </div>
          <div className="space-y-2">
            {appts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-xl border border-line p-2.5 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[a.status] }} />
                <div className="flex-1">
                  <div className="font-medium">{a.procedure ?? "Atendimento"}</div>
                  <div className="text-xs text-muted">
                    {fmtDateTime(a.startsAt)}
                    {a.room ? ` · ${a.room}` : ""}
                  </div>
                </div>
                <span className="text-xs text-muted">{STATUS_LABEL[a.status]}</span>
              </div>
            ))}
            {appts.length === 0 && <p className="text-sm text-muted">Nenhum agendamento.</p>}
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Tarefas</h2>
            <Modal title="Nova tarefa" trigger="+ Tarefa" triggerClassName="btn-ghost px-2 py-1 text-xs">
              <TaskForm members={opts.members} defaultAssignee={contact.ownerId ?? ctx.memberId} contactId={id} dealId={openDeals[0]?.id} />
            </Modal>
          </div>
          <div className="space-y-2">
            {tasks.map((t) => (
              <form key={t.id} action={setTaskStatus.bind(null, t.id, "done")} className="flex items-start gap-2 rounded-xl border border-line p-2.5 text-sm">
                <button className="mt-0.5 size-4 shrink-0 rounded border border-brand-300 hover:bg-brand-100" title="Concluir" />
                <div>
                  <div className="font-medium">{t.title}</div>
                  <div className={cn("text-xs", t.dueAt < new Date() ? "text-red-600" : "text-muted")}>
                    {fmtDateTime(t.dueAt)} · {t.assignee}
                  </div>
                </div>
              </form>
            ))}
            {tasks.length === 0 && <p className="text-sm text-amber-700">Sem follow-up agendado.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value || "—"}</dd>
    </div>
  );
}

