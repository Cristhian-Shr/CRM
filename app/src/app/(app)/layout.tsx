import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { NotificationBell } from "@/components/layout/notifications";
import { Sidebar } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "@/server/actions/auth";
import { leaveCompany } from "@/server/actions/master";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const notifications = await db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.companyId, ctx.companyId), eq(schema.notifications.userId, ctx.userId)))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(20);

  const roleLabel = ctx.isMaster ? "Admin master" : ctx.role === "admin" ? "Admin" : "Colaborador";

  return (
    <div className="min-h-screen">
      <Sidebar
        companyName={ctx.companyName}
        userName={ctx.userName}
        roleLabel={roleLabel}
        isAdmin={ctx.role === "admin"}
        isMaster={ctx.isMaster}
        logout={logout}
      />
      <div className="lg:pl-72">
        {ctx.impersonating && (
          <div className="flex items-center justify-center gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-900">
            Você está acessando <b>{ctx.companyName}</b> como master. Os acessos ficam registrados.
            <form action={leaveCompany}>
              <button className="underline">Sair da empresa</button>
            </form>
          </div>
        )}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-end gap-2 border-b border-line bg-canvas/90 px-4 backdrop-blur md:px-8">
          <Link href="/clientes" className="input hidden max-w-xs text-muted md:block">
            Buscar cliente...
          </Link>
          <ThemeToggle />
          <NotificationBell items={notifications} />
        </header>
        <main className="p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
