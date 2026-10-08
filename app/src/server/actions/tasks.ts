"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getContactOr404, logActivity, notifyMember } from "@/lib/db/tenant";
import { str, zonedToUtc } from "@/lib/utils";
import { safe } from "../safe";

const { tasks } = schema;

function revalidateTasks(contactId?: string | null) {
  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
  revalidatePath("/funil");
  if (contactId) revalidatePath(`/clientes/${contactId}`);
}

export async function createTask(fd: FormData) {
  return safe(async () => {
    const ctx = await getContext();
    const contactId = str(fd, "contactId");
    if (contactId) await getContactOr404(ctx, contactId);
    const assignedTo = str(fd, "assignedTo") ?? ctx.memberId;
    if (!assignedTo) throw new Error("Escolha o responsável pela tarefa.");
    const member = await db.query.companyMembers.findFirst({
      where: and(eq(schema.companyMembers.id, assignedTo), eq(schema.companyMembers.companyId, ctx.companyId)),
    });
    if (!member) throw new Error("Responsável inválido.");
    const due = z.string().min(10, "Informe data e hora.").parse(str(fd, "dueAt"));
    const dueAt = zonedToUtc(due);
    const remindMinutes = Number(str(fd, "remindMinutes") ?? 15);
    const title = z.string().min(2, "Informe o título.").parse(str(fd, "title"));

    await db.insert(tasks).values({
      companyId: ctx.companyId,
      contactId,
      dealId: str(fd, "dealId"),
      assignedTo,
      createdBy: ctx.userId,
      type: str(fd, "type") ?? "follow_up",
      title,
      description: str(fd, "description"),
      dueAt,
      remindAt: remindMinutes >= 0 ? new Date(dueAt.getTime() - remindMinutes * 60_000) : null,
    });
    if (contactId) await logActivity(db, ctx, { contactId, type: "task_created", payload: { title, dueAt: dueAt.toISOString() } });
    if (assignedTo !== ctx.memberId) {
      await notifyMember(db, ctx.companyId, assignedTo, {
        type: "task_assigned",
        title: "Nova tarefa para você",
        body: title,
        link: contactId ? `/clientes/${contactId}` : "/tarefas",
      });
    }
    revalidateTasks(contactId);
  });
}

export async function setTaskStatus(taskId: string, status: "done" | "pending" | "cancelled") {
  const ctx = await getContext();
  const task = await db.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.companyId, ctx.companyId)) });
  if (!task) return;
  if (ctx.role !== "admin" && task.assignedTo !== ctx.memberId && task.createdBy !== ctx.userId) return;
  await db
    .update(tasks)
    .set({ status, completedAt: status === "done" ? new Date() : null })
    .where(eq(tasks.id, taskId));
  if (status === "done" && task.contactId) {
    await logActivity(db, ctx, { contactId: task.contactId, type: "task_done", payload: { title: task.title } });
  }
  revalidateTasks(task.contactId);
}
