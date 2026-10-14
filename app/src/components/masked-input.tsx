"use client";

import { useState } from "react";

const onlyDigits = (s: string) => s.replace(/\D/g, "");

/** Formata dígitos como CNPJ: "11222333000144" → "11.222.333/0001-44". */
export function maskCnpj(raw: string) {
  const d = onlyDigits(raw).slice(0, 14);
  if (d.length > 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length > 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  if (d.length > 5) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length > 2) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return d;
}

/** Formata dígitos como telefone BR: "(11) 99999-9999" ou "(11) 9999-9999". */
export function maskPhone(raw: string) {
  const d = onlyDigits(raw).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function MaskedInput({
  name,
  mask,
  defaultValue = "",
  placeholder,
  className = "input",
}: {
  name: string;
  mask: (raw: string) => string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = useState(mask(String(defaultValue)));
  return (
    <input
      name={name}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => setValue(mask(e.target.value))}
      placeholder={placeholder}
      className={className}
      autoComplete="off"
    />
  );
}

/** Campo de CNPJ com máscara (só aceita números). */
export function CnpjInput(props: { name: string; defaultValue?: string; className?: string }) {
  return <MaskedInput {...props} mask={maskCnpj} placeholder="00.000.000/0000-00" />;
}

/** Campo de telefone BR com máscara (só aceita números). */
export function PhoneInput(props: { name: string; defaultValue?: string; className?: string }) {
  return <MaskedInput {...props} mask={maskPhone} placeholder="(00) 00000-0000" />;
}
