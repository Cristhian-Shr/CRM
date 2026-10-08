import { and, asc, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import Link from "next/link";
import { Modal } from "@/components/modal";
import { TaskForm } from "@/components/tasks/task-form";
import { Empty, PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { cn, fmtDateTime, todayISO, zonedToUtc } from "@/lib/utils";
import { setTaskStatus } from "@/server/actions/tasks";
import { agendaOptions } from "@/server/options";

export const metadata = { title: "Tarefas" };

const TYPE: Record<string, string> = { follow_up: "Follow-up", call: "Ligação", whatsapp: "WhatsApp", meeting: "Reunião", other: "Outro" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filtro?: string; resp?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const filtro = sp.filtro ?? "pendentes";
  const isAdmin = ctx.role === "admin";
  const resp = isAdmin ? (sp.resp ?? "") : (ctx.memberId ?? "");
  const today = todayISO();
  const startToday = zonedToUtc(`${today}T00:00`);
  const endToday = new Date(startToday.getTime() + 86_400_000);

  const conds: (SQL | undefined)[] = [eq(schema.tasks.companyId, ctx.companyId), resp ? eq(schema.tasks.assignedTo, resp) : undefined];
  if (filtro === "concluidas") conds.push(eq(schema.tasks.status, "done"));
  else {
    conds.push(eq(schema.tasks.status, "pending"));
    if (filtro === "atrasadas") conds.push(lt(schema.tasks.dueAt, new Date()));
    if (filtro === "hoje") conds.push(gte(schema.tasks.dueAt, startToday), lt(schema.tasks.dueAt, endToday));
  }

  const [rows, opts] = await Promise.all([
    db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        type: schema.tasks.type,
        description: schema.tasks.description,
        dueAt: schema.tasks.dueAt,
        status: schema.tasks.status,
        contactId: schema.tasks.contactId,
        contactName: schema.contacts.name,
        assignee: schema.users.name,
      })
      .from(schema.tasks)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.tasks.contactId))
      .innerJoin(schema.companyMembers, eq(schema.companyMembers.id, schema.tasks.assignedTo))
      .innerJoin(schema.users, eq(schema.users.id, schema.companyMembers.userId))
      .where(and(...conds))
      .orderBy(filtro === "concluidas" ? desc(schema.tasks.completedAt) : asc(schema.tasks.dueAt))
      .limit(300),
    agendaOptions(ctx),
  ]);

  const tabs = [
    ["pendentes", "Pendentes"],
    ["hoje", "Hoje"],
    ["atrasadas", "Atrasadas"],
    ["concluidas", "Concluídas"],
  ];

  return (
    <>
      <PageHeader
        title="Tarefas e lembretes"
        subtitle="Follow-ups com data e hora. O lembrete aparece no sino de notificações."
        actions={
          <Modal title="Nova tarefa" trigger="+ Nova tarefa">
            <TaskForm members={opts.members} defaultAssignee={ctx.memberId} contacts={opts.contacts} />
          </Modal>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-line bg-surface p-1">
          {tabs.map(([k, l]) => (
            <Link
              key={k}
              href={`?${new URLSearchParams({ filtro: k, ...(sp.resp ? { resp: sp.resp } : {}) })}`}
              className={cn("rounded-lg px-3 py-1 text-sm", filtro === k ? "bg-brand-500 text-white" : "text-muted")}
            >
              {l}
            </Link>
          ))}
        </div>
        {isAdmin && (
          <form className="flex gap-2">
            <input type="hidden" name="filtro" value={filtro} />
            <select name="resp" defaultValue={resp} className="input w-48">
              <option value="">Toda a equipe</option>
              {opts.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button className="btn-secondary">Filtrar</button>
          </form>
        )}
      </div>
      {rows.length === 0 ? (
        <Empty>Nenhuma tarefa aqui.</Empty>
      ) : (
        <div className="card divide-y divide-line">
          {rows.map((t) => {
            const late = t.status === "pending" && t.dueAt < new Date();
            return (
              <div key={t.id} className="flex items-start gap-3 p-4">
                <form action={setTaskStatus.bind(null, t.id, t.status === "done" ? "pending" : "done")}>
                  <button
                    className={cn(
                      "mt-0.5 flex size-5 items-center justify-center rounded border text-xs",
                      t.status === "done" ? "border-green-600 bg-green-600 text-white" : "border-brand-300 hover:bg-brand-100",
                    )}
                    title={t.status === "done" ? "Reabrir" : "Concluir"}
                  >
                    {t.status === "done" ? "✓" : ""}
                  </button>
                </form>
                <div className="min-w-0 flex-1">
                  <div className={cn("font-medium", t.status === "done" && "text-muted line-through")}>{t.title}</div>
                  {t.description && <div className="text-sm text-muted">{t.description}</div>}
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    <span className="badge bg-brand-50 text-brand-700">{TYPE[t.type] ?? t.type}</span>
                    {t.contactId && (
                      <Link href={`/clientes/${t.contactId}`} className="hover:text-brand-600">
                        {t.contactName}
                      </Link>
                    )}
                    <span>{t.assignee}</span>
                  </div>
                </div>
                <div className={cn("text-right text-sm", late ? "font-semibold text-red-600" : "text-muted")}>
                  {late && <div className="text-xs">Atrasada</div>}
                  {fmtDateTime(t.dueAt)}
                </div>
                {t.status === "pending" && (
                  <form action={setTaskStatus.bind(null, t.id, "cancelled")}>
                    <button className="btn-ghost px-2 py-1 text-xs">Cancelar</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
