import { and, eq, isNull, lte } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/lib/db";
import { notifyMember } from "@/lib/db/tenant";
import { fmtDateTime } from "@/lib/utils";
import { cronAuthorized } from "../auth";

export const dynamic = "force-dynamic";

/** Roda a cada 5 minutos: dispara os lembretes de tarefas no sino de notificações. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return new NextResponse("unauthorized", { status: 401 });
  const due = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "pending"), isNull(schema.tasks.remindedAt), lte(schema.tasks.remindAt, new Date())))
    .limit(500);
  for (const t of due) {
    await notifyMember(db, t.companyId, t.assignedTo, {
      type: "task_reminder",
      title: `Lembrete: ${t.title}`,
      body: `Para ${fmtDateTime(t.dueAt)}`,
      link: t.contactId ? `/clientes/${t.contactId}` : "/tarefas",
    });
    await db.update(schema.tasks).set({ remindedAt: new Date() }).where(eq(schema.tasks.id, t.id));
  }
  return NextResponse.json({ reminded: due.length });
}
