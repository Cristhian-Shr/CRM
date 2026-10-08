import { and, eq } from "drizzle-orm";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { logout, selectCompany } from "@/server/actions/auth";

export default async function SelectCompanyPage({ searchParams }: { searchParams: Promise<{ suspensa?: string }> }) {
  const found = await getUser();
  if (!found) redirect("/login");
  const { suspensa } = await searchParams;

  const companies = await db
    .select({ id: schema.companies.id, name: schema.companies.name, role: schema.companyMembers.role })
    .from(schema.companyMembers)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.companyMembers.companyId))
    .where(
      and(
        eq(schema.companyMembers.userId, found.user.id),
        eq(schema.companyMembers.active, true),
        eq(schema.companies.status, "active"),
      ),
    );

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-semibold">Olá, {found.user.name.split(" ")[0]}</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Escolha a empresa que deseja acessar.</p>
        {suspensa && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Esta empresa está suspensa.</p>}
        <div className="space-y-2">
          {companies.map((c) => (
            <form key={c.id} action={selectCompany.bind(null, c.id)}>
              <button className="flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left hover:bg-brand-50">
                <Building2 className="size-5 text-brand-500" />
                <span className="flex-1 font-medium">{c.name}</span>
                <span className="text-xs text-muted">{c.role === "admin" ? "Admin" : "Colaborador"}</span>
              </button>
            </form>
          ))}
          {companies.length === 0 && <p className="text-sm text-muted">Você ainda não está vinculado a nenhuma empresa.</p>}
        </div>
        <div className="mt-6 flex justify-between">
          {found.user.isMaster && (
            <Link href="/master" className="btn-secondary">
              Área master
            </Link>
          )}
          <form action={logout}>
            <button className="btn-ghost">Sair</button>
          </form>
        </div>
      </div>
    </main>
  );
}
