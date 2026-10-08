import { Field, Form, Submit } from "@/components/form";
import { createTask } from "@/server/actions/tasks";

type Opt = { id: string; name: string };

export function TaskForm({
  members,
  defaultAssignee,
  contactId,
  dealId,
  contacts,
}: {
  members: Opt[];
  defaultAssignee: string | null;
  contactId?: string;
  dealId?: string;
  contacts?: Opt[];
}) {
  return (
    <Form action={createTask}>
      {contactId ? (
        <input type="hidden" name="contactId" value={contactId} />
      ) : (
        contacts && (
          <Field label="Cliente (opcional)">
            <select name="contactId" className="input" defaultValue="">
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )
      )}
      {dealId && <input type="hidden" name="dealId" value={dealId} />}
      <Field label="Título">
        <input name="title" required className="input" placeholder="Ligar para confirmar avaliação" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <select name="type" className="input">
            <option value="follow_up">Follow-up</option>
            <option value="call">Ligação</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="meeting">Reunião</option>
            <option value="other">Outro</option>
          </select>
        </Field>
        <Field label="Responsável">
          <select name="assignedTo" className="input" defaultValue={defaultAssignee ?? ""} required>
            <option value="">Selecione...</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data e hora">
          <input name="dueAt" type="datetime-local" required className="input" />
        </Field>
        <Field label="Lembrete">
          <select name="remindMinutes" className="input" defaultValue="15">
            <option value="0">Na hora</option>
            <option value="15">15 min antes</option>
            <option value="60">1 hora antes</option>
            <option value="1440">1 dia antes</option>
            <option value="-1">Sem lembrete</option>
          </select>
        </Field>
      </div>
      <Field label="Descrição">
        <textarea name="description" rows={2} className="input" />
      </Field>
      <Submit>Criar tarefa</Submit>
    </Form>
  );
}
