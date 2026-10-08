"use client";

import { useState } from "react";

/** Campo de senha visível (texto) com botão para gerar uma senha aleatória. */
export function PasswordInput({ name, defaultValue = "" }: { name: string; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);

  function generate() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setValue(s);
  }

  return (
    <div className="flex gap-2">
      <input
        name={name}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        placeholder="Deixe em branco para manter"
        className="input"
      />
      <button type="button" onClick={generate} className="btn-secondary whitespace-nowrap">
        Gerar
      </button>
    </div>
  );
}
