import type { getContext } from "@/lib/auth";
import type { schema } from "@/lib/db";

type Ctx = Awaited<ReturnType<typeof getContext>>;
type Conn = typeof schema.metaConnections.$inferSelect;

export async function AlertaSaldoTab({ ctx, conns }: { ctx: Ctx; conns: Conn[] }) {
  void ctx;
  void conns;
  return <div className="card p-6 text-sm text-muted">Em construção.</div>;
}
