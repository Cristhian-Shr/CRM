import type { getContext } from "@/lib/auth";
import type { TrafegoSearch } from "@/lib/trafego";

type Ctx = Awaited<ReturnType<typeof getContext>>;

export async function ResumoTab({ ctx, sp }: { ctx: Ctx; sp: TrafegoSearch }) {
  void ctx;
  void sp;
  return <div className="card p-6 text-sm text-muted">Em construção.</div>;
}
