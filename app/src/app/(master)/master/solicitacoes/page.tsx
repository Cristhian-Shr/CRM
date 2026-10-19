import { desc, eq } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { serviceMeta } from "@/lib/services";
import { cn, fmtDate } from "@/lib/utils";
import { resolveServiceRequest } from "@/server/actions/master";

export const metadata = { title: "Solicitações" };

export default async function ServiceRequestsPage() {
  const rows = await db
    .select({
      id: schema.serviceRequests.id,
      service: schema.serviceRequests.service,
      note: schema.serviceRequests.note,
      createdAt: schema.serviceRequests.createdAt,
      companyName: schema.companies.name,
    })
    .from(schema.serviceRequests)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.serviceRequests.companyId))
    .where(eq(schema.serviceRequests.status, "pending"))
    .orderBy(desc(schema.serviceRequests.createdAt));

  return (
    <>
      <PageHeader title="Solicitações de serviço" subtitle={`${rows.length} pendente(s)`} />
      {rows.length === 0 ? (
        <Empty>Nenhuma solicitação pendente.</Empty>
      ) : (
        <div className="card divide-y divide-line">
          {rows.map((r) => {
            const meta = serviceMeta(r.service);
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.companyName}</span>
                    <span className={cn("badge", meta?.badge ?? "bg-canvas text-muted")}>{meta?.label ?? r.service}</span>
                  </div>
                  {r.note && <p className="mt-1 text-sm text-muted">{r.note}</p>}
                  <p className="mt-1 text-xs text-muted">Solicitado em {fmtDate(r.createdAt)}</p>
                </div>
                <Link href="/master/empresas" className="btn-secondary justify-between gap-2 text-sm">
                  Abrir empresa <ArrowRight className="size-4" />
                </Link>
                <form action={resolveServiceRequest.bind(null, r.id)}>
                  <button className="btn-primary text-sm">Marcar como resolvida</button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
