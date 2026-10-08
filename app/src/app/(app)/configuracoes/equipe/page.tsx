import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { Avatar, PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { listMembers } from "@/lib/db/tenant";
import { cn } from "@/lib/utils";
import { addMember, setMemberActive, updateMember } from "@/server/actions/settings";

export const metadata = { title: "Equipe" };

type Member = Awaited<ReturnType<typeof listMembers>>[number];

function MemberFields({ m }: { m?: Member }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Papel">
          <select name="role" defaultValue={m?.role ?? "collaborator"} className="input">
            <option value="collaborator">Colaborador</option>
            <option value="admin">Admin da clínica</option>
          </select>
        </Field>
        <Field label="Cargo">
          <input name="jobTitle" defaultValue={m?.jobTitle ?? ""} className="input" placeholder="Consultora, Esteticista..." />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isSeller" defaultChecked={m?.isSeller ?? true} className="accent-brand-500" /> Vendedora
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isProfessional" defaultChecked={m?.isProfessional ?? false} className="accent-brand-500" /> Atende na agenda
        </label>
        <label className="flex items-center gap-2">
          Cor <input type="color" name="color" defaultValue={m?.color ?? "#be5574"} className="size-7 rounded" />
        </label>
      </div>
    </>
  );
}

export default async function TeamPage() {
  const ctx = await getContext();
  const members = await listMembers(ctx.companyId);

  return (
    <>
      <PageHeader
        title="Equipe"
        subtitle="Admins gerenciam a clínica. Colaboradores trabalham leads, agenda e tarefas."
        actions={
          <Modal title="Adicionar pessoa" trigger="+ Adicionar pessoa">
            <Form action={addMember}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome">
                  <input name="name" className="input" />
                </Field>
                <Field label="E-mail">
                  <input name="email" type="email" required className="input" />
                </Field>
              </div>
              <Field label="Senha inicial">
                <input name="password" minLength={8} className="input" placeholder="Não precisa se a pessoa já tem acesso ao sistema" />
              </Field>
              <MemberFields />
              <Submit>Adicionar</Submit>
            </Form>
          </Modal>
        }
      />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Papel</th>
              <th>Cargo</th>
              <th>Funções</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className={cn(!m.active && "opacity-50")}>
                <td>
                  <div className="flex items-center gap-3">
                    <Avatar name={m.name} color={m.color} />
                    <div>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-muted">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td>{m.role === "admin" ? "Admin" : "Colaborador"}</td>
                <td className="text-muted">{m.jobTitle ?? "—"}</td>
                <td className="text-xs text-muted">{[m.isSeller && "Vendas", m.isProfessional && "Agenda"].filter(Boolean).join(" · ") || "—"}</td>
                <td>
                  <div className="flex justify-end gap-2">
                    <Modal title={`Editar ${m.name}`} trigger="Editar" triggerClassName="btn-ghost px-2 py-1 text-xs">
                      <Form action={updateMember.bind(null, m.id)} resetOnSuccess={false}>
                        <MemberFields m={m} />
                        <Field label="Nova senha (opcional)">
                          <input name="password" minLength={8} className="input" />
                        </Field>
                        <Submit>Salvar</Submit>
                      </Form>
                    </Modal>
                    {m.id !== ctx.memberId && (
                      <form action={setMemberActive.bind(null, m.id, !m.active)}>
                        <button className="btn-ghost px-2 py-1 text-xs">{m.active ? "Desativar" : "Reativar"}</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
