import { asc, desc, eq, sql } from "drizzle-orm";
import { Pencil, Trash2 } from "lucide-react";
import { getSession } from "@/lib/auth";
import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { PasswordInput } from "@/components/password-input";
import { PageHeader } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { fmtDateTime } from "@/lib/utils";
import { createUser, deleteUser, setUserStatus, updateUser } from "@/server/actions/master";

export const metadata = { title: "Usuários" };

export default async function MasterUsersPage() {
  const session = await getSession();
  const currentUserId = session?.userId;
  const users = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      isMaster: schema.users.isMaster,
      status: schema.users.status,
      lastLoginAt: schema.users.lastLoginAt,
      companies: sql<string>`(select string_agg(c.name || ' (' || case m.role when 'admin' then 'admin' else 'colab.' end || ')', ', ')
        from company_members m join companies c on c.id = m.company_id where m.user_id = "users"."id")`,
    })
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt));

  const companies = await db
    .select({ id: schema.companies.id, name: schema.companies.name })
    .from(schema.companies)
    .where(eq(schema.companies.status, "active"))
    .orderBy(asc(schema.companies.name));

  return (
    <>
      <PageHeader
        title="Usuários"
        subtitle="Todos os usuários do sistema"
        actions={
          <Modal title="Novo usuário" trigger="+ Novo usuário">
            <Form action={createUser}>
              <Field label="Nome">
                <input name="name" required className="input" />
              </Field>
              <Field label="E-mail">
                <input name="email" type="email" required className="input" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Empresa">
                  <select name="companyId" required defaultValue="" className="input">
                    <option value="" disabled>
                      Selecione...
                    </option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Nível de acesso">
                  <select name="role" defaultValue="collaborator" className="input">
                    <option value="admin">Administrador (acesso total)</option>
                    <option value="collaborator">Colaborador (acesso limitado)</option>
                  </select>
                </Field>
              </div>
              <Field label="Senha">
                <PasswordInput name="password" />
              </Field>
              <p className="text-xs text-muted">
                Senha obrigatória para usuários novos. Se o e-mail já existir, o usuário é apenas vinculado à empresa (sem alterar a
                senha).
              </p>
              <Submit>Criar usuário</Submit>
            </Form>
          </Modal>
        }
      />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Empresas</th>
              <th>Último acesso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">
                  {u.name} {u.isMaster && <span className="badge bg-brand-100 text-brand-700">master</span>}
                </td>
                <td>{u.email}</td>
                <td className="text-muted">{u.companies ?? "—"}</td>
                <td>{fmtDateTime(u.lastLoginAt) || "—"}</td>
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    <Modal
                      title={`Editar ${u.name}`}
                      trigger={
                        <>
                          <Pencil className="size-3.5" /> Editar
                        </>
                      }
                      triggerClassName="btn-ghost text-xs"
                    >
                      <Form action={updateUser.bind(null, u.id)}>
                        <Field label="Nome">
                          <input name="name" required defaultValue={u.name} className="input" />
                        </Field>
                        <Field label="E-mail">
                          <input name="email" type="email" required defaultValue={u.email} className="input" />
                        </Field>
                        <Field label="Nova senha (deixe em branco para manter a atual)">
                          <PasswordInput name="password" />
                        </Field>
                        <p className="text-xs text-muted">
                          A senha atual não pode ser exibida (fica criptografada). Defina uma nova aqui para trocá-la.
                        </p>
                        <Submit>Salvar</Submit>
                      </Form>
                    </Modal>
                    {!u.isMaster && (
                      <form action={setUserStatus.bind(null, u.id, u.status === "active" ? "disabled" : "active")}>
                        <button className="btn-ghost text-xs">{u.status === "active" ? "Desativar" : "Reativar"}</button>
                      </form>
                    )}
                    {!u.isMaster && u.id !== currentUserId && (
                      <Modal
                        title={`Excluir ${u.name}`}
                        trigger={
                          <>
                            <Trash2 className="size-3.5" /> Excluir
                          </>
                        }
                        triggerClassName="btn-ghost text-xs text-red-600 hover:text-red-700"
                      >
                        <Form action={deleteUser.bind(null, u.id)}>
                          <p className="text-sm text-muted">
                            Isso exclui <b className="text-ink">{u.name}</b> de vez e remove o acesso dele a todas as empresas. O
                            histórico criado por ele é mantido, porém sem autor. Esta ação é <b className="text-ink">irreversível</b>.
                          </p>
                          <Field label={`Digite "${u.name}" para confirmar`}>
                            <input name="confirm" required autoComplete="off" className="input" placeholder={u.name} />
                          </Field>
                          <Submit className="btn-danger">Excluir definitivamente</Submit>
                        </Form>
                      </Modal>
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
