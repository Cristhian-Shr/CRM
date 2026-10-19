# Leads/Clientes — Editar e Excluir na lista — Design

**Data:** 2026-10-15
**Autor:** Cristhian S. Schröer (com Claude)

## Objetivo

Na lista de Leads/Clientes (`/clientes`), permitir **editar** e **excluir** cada
cadastro direto da linha, via ícones (lápis = editar, lixeira = excluir). O lápis
abre um modal com o formulário completo da ficha (os mesmos campos do cadastro).

## Decisões (brainstorming)

| Tema | Decisão |
|------|---------|
| Ícones | ✏️ lápis (editar) e 🗑️ lixeira (excluir) por linha, em coluna "Ações" |
| Form de edição | **Extrair componente compartilhado** reutilizado na lista e na tela de detalhe |
| Exclusão | `deleteContact` com confirmação (soft delete, já existente) |

## Contexto do que já existe

- `updateContact(contactId, fd)` e `deleteContact(contactId)` já implementados
  (`app/src/server/actions/leads.ts:97` e `:140`). `deleteContact` faz soft delete
  (`deletedAt`) do contato e dos deals, e valida `assertCan(ctx, "leads.delete")`.
- A tela de detalhe (`app/src/app/(app)/clientes/[id]/page.tsx:199-263`) já tem o
  modal **"Editar ficha"** com todos os campos: nome, telefone, whatsapp, e-mail,
  empresa, CPF, nascimento, status, responsável, origem, tags, observações,
  consentimento — salvando via `updateContact.bind(null, id)`.
- Componente `Modal` controlável (`components/modal.tsx`) e `DeleteContact`
  (padrão de exclusão com `useTransition` + `confirm`) em
  `app/(app)/clientes/[id]/actions.tsx:8`.
- Lista em `app/src/app/(app)/clientes/page.tsx` (server component) com tabela.

## Arquitetura

### 1. Componente compartilhado `components/leads/edit-contact.tsx` (novo)

- Exporta `EditContactModal({ contact, members, sources, trigger, triggerClassName })`.
- Contém os campos do form "Editar ficha" (hoje inline na tela de detalhe),
  `Form action={updateContact.bind(null, contact.id)}`.
- Tipo `EditableContact` com os campos necessários: id, name, phone, whatsapp,
  email, companyName, cpf, birthDate, status, ownerId, sourceId, tags, notes,
  consentAt.
- A tela de detalhe passa a **usar esse componente** no lugar do modal inline
  (remove a duplicação), mantendo o mesmo gatilho "Editar".

### 2. Componente `components/leads/lead-actions.tsx` (novo, client)

- Renderiza por linha: botão **lápis** (`Pencil` do lucide) que abre o
  `EditContactModal`; botão **lixeira** (`Trash2`) que chama `deleteContact(id)`
  via `useTransition` com `confirm(...)` (mesma mensagem do padrão atual).
- Props: `contact: EditableContact`, `members`, `sources`, `canDelete: boolean`.
- A lixeira só é renderizada se `canDelete`.

### 3. Lista `app/(app)/clientes/page.tsx`

- Expandir o `select` da query para incluir os campos editáveis
  (whatsapp, companyName, cpf, birthDate, ownerId, sourceId, tags, notes,
  consentAt) — evita segunda busca ao abrir o modal.
- Adicionar coluna `Ações` (header + célula) renderizando `<LeadActions ... />`.
- Calcular `canDelete` uma vez a partir do contexto/permissões e passar às linhas.

## Tratamento de erros / permissões

- `updateContact`/`deleteContact` já validam no servidor (tenant + permissão).
- Botão de exclusão escondido para quem não tem `leads.delete` (defesa em
  profundidade; servidor continua validando).
- Confirmação antes de excluir; mensagem deixa claro que o histórico fica guardado.

## Testes / verificação

- Editar um lead pela lista salva e reflete na lista e no detalhe.
- Excluir remove da lista (soft delete) e mantém histórico.
- Usuário sem `leads.delete` não vê a lixeira.
- Tela de detalhe continua editando normalmente após a extração do componente.

## Fora de escopo (YAGNI)

- Exclusão em massa / seleção múltipla.
- Restaurar lead excluído pela UI.
- Edição inline (sem modal).
