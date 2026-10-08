"use client";

import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

/** Input que envia o formulário ao mudar (filtros por data, mês etc.). */
export function AutoSubmitInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

/** Select que envia o formulário ao mudar. */
export function AutoSubmitSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
