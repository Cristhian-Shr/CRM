import { MasterSidebar } from "@/components/layout/master-sidebar";
import { requireMaster } from "@/lib/auth";
import { logout } from "@/server/actions/auth";

export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireMaster();
  return (
    <div className="min-h-screen">
      <MasterSidebar userName={user.name} logout={logout} />
      <div className="lg:pl-72">
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
