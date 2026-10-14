import { MasterSidebar } from "@/components/layout/master-sidebar";
import { ValuesProvider } from "@/components/values-visibility";
import { requireMaster } from "@/lib/auth";
import { logout } from "@/server/actions/auth";

export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireMaster();
  return (
    <ValuesProvider>
      <div className="min-h-screen">
        <MasterSidebar userName={user.name} logout={logout} />
        <div className="lg:pl-72">
          <main className="mx-auto flex min-h-screen max-w-6xl flex-col p-4 md:p-8">{children}</main>
        </div>
      </div>
    </ValuesProvider>
  );
}
