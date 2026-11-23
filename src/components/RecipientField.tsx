import { useState, type FormEvent } from "react";
import { AddressBook } from "@phosphor-icons/react";
import type { ContactKind } from "../contacts/logic";
import { addContact, useContacts } from "../contacts/store";
import { useRecipient } from "../contacts/useRecipient";
import { errMsg, shortAddr } from "../lib/format";
import WalletAvatar from "./WalletAvatar";
import { Button, Field, Modal, StatusDot, inputCls } from "./ui";

/** Kolom alamat penerima dengan pemilih kontak, nama kontak terdeteksi, dan "Simpan ke kontak". */
export default function RecipientField({
  kind,
  value,
  onChange,
  hint,
  placeholder,
  self,
}: {
  kind: ContactKind;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder: string;
  self?: string | null;
}) {
  const contacts = useContacts();
  const r = useRecipient(kind, value, self);
  const list = contacts.filter((c) => c.kind === kind);
  const [pick, setPick] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const shown = list.filter((c) => !query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase()));

  function save(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      addContact({ name, address: value, kind });
      setSaving(false);
      setName("");
    } catch (ex) {
      setErr(errMsg(ex));
    }
  }

  return (
    <div className="grid gap-2">
      <Field label="Alamat penerima" hint={hint} error={r.blocked ? "Whitelist aktif: alamat ini belum ada di Kontak." : undefined}>
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} font-mono`}
          />
          {list.length > 0 && (
            <Button type="button" variant="ghost" onClick={() => setPick(true)} aria-label="Pilih dari kontak">
              <AddressBook />
            </Button>
          )}
        </div>
      </Field>

      {r.contact && (
        <p className="flex items-center gap-2 text-xs text-zinc-300">
          <StatusDot tone="ok" still />
          {r.contact.name}
        </p>
      )}

      {!r.contact && r.norm && !r.isSelf && !saving && (
        <button type="button" onClick={() => setSaving(true)} className="justify-self-start text-xs text-accent hover:underline">
          Simpan ke kontak
        </button>
      )}
      {saving && (
        <div className="glass-surface grid gap-2 rounded-xl border border-white/10 p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama kontak"
            maxLength={24}
            autoFocus
            className={inputCls}
            onKeyDown={(e) => {
              if (e.key === "Enter") save(e);
            }}
          />
          {err && <p className="text-xs text-rose-400">{err}</p>}
          <div className="flex gap-3">
            <Button type="button" onClick={save} disabled={!name.trim()} className="!px-3 !py-2 text-xs">
              Simpan
            </Button>
            <button
              type="button"
              onClick={() => {
                setSaving(false);
                setErr("");
              }}
              className="text-xs text-zinc-500 hover:text-zinc-200"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      <Modal open={pick} onClose={() => setPick(false)} title="Pilih kontak">
        <div className="grid gap-3">
          {list.length > 6 && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama" className={inputCls} />}
          <ul className="grid max-h-[50dvh] gap-1 overflow-y-auto">
            {shown.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(c.address);
                    setPick(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors duration-300 hover:bg-white/5"
                >
                  <WalletAvatar seed={c.address} label={c.name} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-zinc-100">{c.name}</span>
                    <span className="block font-mono text-xs text-zinc-500">{shortAddr(c.address)}</span>
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-3 text-sm text-zinc-500">Tidak ada hasil.</li>}
          </ul>
        </div>
      </Modal>
    </div>
  );
}
