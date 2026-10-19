"use client";

import type { ReactNode } from "react";
import { Field, Form, Submit } from "@/components/form";
import { Modal } from "@/components/modal";
import { PhoneInput } from "@/components/phone-input";
import { fmtPhone } from "@/lib/utils";
import { updateContact } from "@/server/actions/leads";

type Opt = { id: string; name: string };

export type EditableContact = {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  companyName: string | null;
  cpf: string | null;
  birthDate: string | null;
  status: string;
  ownerId: string | null;
  sourceId: string | null;
  tags: string[];
  notes: string | null;
  consentAt: Date | string | null;
};

/** Modal reutilizável para editar a ficha completa de um lead/cliente. */
export function EditContactModal({
  contact,
  members,
  sources,
  trigger,
  triggerClassName,
}: {
  contact: EditableContact;
  members: Opt[];
  sources: Opt[];
  trigger: ReactNode;
  triggerClassName?: string;
}) {
  return (
    <Modal title="Editar ficha" trigger={trigger} triggerClassName={triggerClassName}>
      <Form action={updateContact.bind(null, contact.id)} resetOnSuccess={false}>
        <Field label="Nome">
          <input name="name" required defaultValue={contact.name} className="input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Telefone">
            <PhoneInput name="phone" defaultValue={fmtPhone(contact.phone)} />
          </Field>
          <Field label="WhatsApp (se diferente)">
            <PhoneInput name="whatsapp" defaultValue={contact.whatsapp !== contact.phone ? fmtPhone(contact.whatsapp) : ""} />
          </Field>
          <Field label="E-mail">
            <input name="email" type="email" defaultValue={contact.email ?? ""} className="input" />
          </Field>
          <Field label="Empresa">
            <input name="companyName" defaultValue={contact.companyName ?? ""} className="input" />
          </Field>
          <Field label="CPF">
            <input name="cpf" defaultValue={contact.cpf ?? ""} className="input" />
          </Field>
          <Field label="Nascimento">
            <input name="birthDate" type="date" defaultValue={contact.birthDate ?? ""} className="input" />
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={contact.status} className="input">
              <option value="lead">Lead</option>
              <option value="client">Cliente</option>
              <option value="inactive">Inativo</option>
            </select>
          </Field>
          <Field label="Responsável">
            <select name="ownerId" defaultValue={contact.ownerId ?? ""} className="input">
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Origem">
            <select name="sourceId" defaultValue={contact.sourceId ?? ""} className="input">
              <option value="">—</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tags (separadas por vírgula)">
            <input name="tags" defaultValue={contact.tags.join(", ")} className="input" />
          </Field>
        </div>
        <Field label="Observações">
          <textarea name="notes" rows={3} defaultValue={contact.notes ?? ""} className="input" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="consent" defaultChecked={!!contact.consentAt} className="accent-brand-500" />
          Cliente autorizou contato (LGPD)
        </label>
        <Submit>Salvar</Submit>
      </Form>
    </Modal>
  );
}
