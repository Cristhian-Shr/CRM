import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { MoneyInput } from "@/components/money-input";
import { PhoneInput } from "@/components/phone-input";
import { createLead } from "@/server/actions/leads";

type Opt = { id: string; name: string };

export function NewLeadButton({
  members,
  sources,
  stages,
  defaultOwner,
}: {
  members: Opt[];
  sources: Opt[];
  stages: Opt[];
  defaultOwner: string | null;
}) {
  return (
    <Modal title="Novo lead" trigger="+ Novo lead">
      <Form action={createLead}>
        <Field label="Nome">
          <input name="name" required className="input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Telefone / WhatsApp">
            <PhoneInput name="phone" />
          </Field>
          <Field label="E-mail">
            <input name="email" type="email" autoComplete="email" className="input" placeholder="nome@email.com" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Origem">
            <select name="sourceId" className="input" defaultValue="">
              <option value="">—</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Responsável">
            <select name="ownerId" className="input" defaultValue={defaultOwner ?? ""}>
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Interesse (título)">
            <input name="title" className="input" placeholder="Programa Corpo Verão" />
          </Field>
          <Field label="Valor estimado (R$)">
            <MoneyInput name="value" />
          </Field>
        </div>
        <Field label="Etapa">
          <select name="stageId" className="input">
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Observações">
          <textarea name="notes" rows={2} className="input" />
        </Field>
        <Submit>Cadastrar lead</Submit>
      </Form>
    </Modal>
  );
}
