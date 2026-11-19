import type { getContext } from "@/lib/auth";
import type { schema } from "@/lib/db";
import type { TrafegoSearch } from "@/lib/trafego";

type Ctx = Awaited<ReturnType<typeof getContext>>;
type Conn = typeof schema.metaConnections.$inferSelect;

export async function VinculosTab({ ctx, sp, conns }: { ctx: Ctx; sp: TrafegoSearch; conns: Conn[] }) {
  void ctx;
  void sp;
  void conns;
  return <div className="card p-6 text-sm text-muted">Em construção.</div>;
}
