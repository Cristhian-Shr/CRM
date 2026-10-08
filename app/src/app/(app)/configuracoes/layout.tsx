import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  if (ctx.role !== "admin") redirect("/dashboard");
  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/configuracoes" className="btn-secondary">
          Geral e funil
        </Link>
        <Link href="/configuracoes/equipe" className="btn-secondary">
          Equipe
        </Link>
        <Link href="/configuracoes/integracoes" className="btn-secondary">
          Integrações
        </Link>
      </div>
      {children}
    </>
  );
}
