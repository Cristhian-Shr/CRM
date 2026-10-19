import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { COMPANY_SERVICES } from "@/lib/services";
import { cn } from "@/lib/utils";
import { requestService } from "@/server/actions/services";

export const metadata = { title: "Serviços" };

export default async function ServicesPage() {
  const ctx = await getContext();
  if (ctx.role !== "admin") redirect("/dashboard");

  const [active, pending] = await Promise.all([
    db.select({ service: schema.companyServices.service }).from(schema.companyServices).where(eq(schema.companyServices.companyId, ctx.companyId)),
    db
      .select({ service: schema.serviceRequests.service })
      .from(schema.serviceRequests)
      .where(and(eq(schema.serviceRequests.companyId, ctx.companyId), eq(schema.serviceRequests.status, "pending"))),
  ]);
  const activeSet = new Set(active.map((a) => a.service));
  const pendingSet = new Set(pending.map((p) => p.service));

  return (
    <>
      <PageHeader title="Serviços" subtitle="Serviços da agência disponíveis para a sua clínica. Solicite a contratação e nossa equipe entra em contato." />
      <div className="grid gap-4 sm:grid-cols-2">
        {COMPANY_SERVICES.map((s) => {
          const isActive = activeSet.has(s.key);
          const isPending = pendingSet.has(s.key);
          return (
            <div key={s.key} className="card flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-semibold">{s.label}</h2>
                <span className={cn("badge", s.badge)}>{s.short}</span>
              </div>
              <p className="flex-1 text-sm text-muted">{s.description}</p>
              {isActive ? (
                <span className="badge w-fit bg-emerald-50 text-emerald-700">Ativo</span>
              ) : isPending ? (
                <span className="badge w-fit bg-amber-50 text-amber-700">Solicitado · aguardando</span>
              ) : (
                <Modal title={`Solicitar: ${s.label}`} trigger="Solicitar contratação" triggerClassName="btn-primary w-fit">
                  <Form action={requestService}>
                    <input type="hidden" name="service" value={s.key} />
                    <p className="text-sm text-muted">{s.description}</p>
                    <Field label="Observação (opcional)">
                      <textarea name="note" rows={3} className="input" placeholder="Conte um pouco do que você precisa..." />
                    </Field>
                    <Submit>Enviar solicitação</Submit>
                  </Form>
                </Modal>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
