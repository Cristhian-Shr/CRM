import { desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { fmtDateTime } from "@/lib/utils";

export default async function AuditPage() {
  const logs = await db
    .select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      createdAt: schema.auditLogs.createdAt,
      user: schema.users.name,
      company: schema.companies.name,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.userId))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.auditLogs.companyId))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(300);

  return (
    <>
      <PageHeader title="Auditoria" subtitle="Acessos e ações sensíveis (LGPD)" />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Usuário</th>
              <th>Empresa</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{fmtDateTime(l.createdAt)}</td>
                <td>{l.user ?? "—"}</td>
                <td>{l.company ?? "—"}</td>
                <td className="font-mono text-xs">{l.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
