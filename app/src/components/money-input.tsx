"use client";

import { useState } from "react";

/** Formata dígitos como moeda brasileira tratando o número como centavos: "123456" → "1.234,56". */
export function maskMoney(raw: string) {
  const cents = Number(raw.replace(/\D/g, "")) || 0;
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const fmt = maskMoney;

/**
 * Campo de dinheiro (R$) que aceita só números e formata conforme digita.
 * O valor enviado ("1.234,56") é compatível com parseMoney no servidor.
 * defaultValue aceita uma string em reais (ex.: centsToInput → "1500,00") ou vazio.
 */
export function MoneyInput({
  name,
  defaultValue = "",
  required,
  placeholder = "0,00",
  className = "input",
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const init = String(defaultValue).replace(/\D/g, "");
  const [value, setValue] = useState(init ? fmt(init) : "");
  return (
    <input
      name={name}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => {
        const d = e.target.value.replace(/\D/g, "");
        setValue(d ? fmt(d) : "");
      }}
      required={required}
      placeholder={placeholder}
      className={className}
    />
  );
}
