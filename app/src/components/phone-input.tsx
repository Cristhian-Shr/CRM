"use client";

import { useState } from "react";

/** Formata um telefone brasileiro: (DD) XXXXX-XXXX (celular) ou (DD) XXXX-XXXX (fixo). */
export function maskBRPhone(raw: string) {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function PhoneInput({
  name,
  defaultValue = "",
  required,
  placeholder = "(51) 99999-8888",
  className = "input",
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = useState(maskBRPhone(defaultValue));
  return (
    <input
      name={name}
      type="tel"
      inputMode="numeric"
      autoComplete="tel"
      value={value}
      onChange={(e) => setValue(maskBRPhone(e.target.value))}
      required={required}
      placeholder={placeholder}
      className={className}
    />
  );
}
