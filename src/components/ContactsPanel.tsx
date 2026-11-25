import { useMemo, useState, type FormEvent } from "react";
import { AddressBook, PencilSimple, Trash } from "@phosphor-icons/react";
import { KIND_NAME, type Contact, type ContactKind } from "../contacts/logic";
import { addContact, removeContact, setStrict, updateContact, useContacts, useStrict } from "../contacts/store";
import { errMsg, shortAddr } from "../lib/format";
import WalletAvatar from "./WalletAvatar";
import { Button, CopyButton, Field, Notice, inputCls } from "./ui";

const KINDS: ContactKind[] = ["evm", "btc", "sol", "zec"];
const PLACEHOLDER: Record<ContactKind, string> = { evm: "0x…", btc: "bc1q…", sol: "Alamat Solana…", zec: "t1…" };

export default function ContactsPanel({ kind: currentKind }: { kind: ContactKind }) {
  const contacts = useContacts();
  const strict = useStrict();
  const [editing, setEditing] = useState<Contact | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<ContactKind>(currentKind);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const form = adding || editing !== null;
  const shown = useMemo(
    () => contacts.filter((c) => !query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)),
    [contacts, query],
  );

  function open(c?: Contact) {
    setErr("");
    setEditing(c ?? null);
    setAdding(!c);
    setName(c?.name ?? "");
    setAddress(c?.address ?? "");
    setNote(c?.note ?? "");
    setKind(c?.kind ?? currentKind);
  }
  function close() {
    setAdding(false);
    setEditing(null);
    setErr("");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      if (editing) updateContact(editing.id, { name, address, kind, note });
      else addContact({ name, address, kind, note });
      close();
    } catch (ex) {
      setErr(errMsg(ex));
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-zinc-100">Whitelist</p>
          <p className="text-xs text-zinc-500">Hanya kirim ke alamat di Kontak</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={strict}
          aria-label="Whitelist"
          onClick={() => setStrict(!strict)}
          className={`relative h-7 w-12 shrink-0 rounded-full border border-white/10 transition-colors duration-300 ${strict ? "glass-lens" : "glass-field"}`}
        >
          <span
            className={`absolute top-0.5 size-6 rounded-full bg-zinc-50 shadow transition-[left] duration-300 ${strict ? "left-[22px]" : "left-0.5"}`}
          />
        </button>
      </div>

      {form ? (
        <form onSubmit={submit} className="glass-surface grid gap-4 rounded-xl border border-white/10 p-4">
          <Field label="Nama">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoFocus className={inputCls} />
          </Field>
          <div className="grid grid-cols-4 gap-1 glass-field rounded-xl border border-white/10 p-0.5 text-xs" role="group" aria-label="Jaringan">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`rounded-[10px] px-2 py-2.5 transition-colors duration-300 ${kind === k ? "glass-lens text-zinc-50" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {KIND_NAME[k]}
              </button>
            ))}
          </div>
          <Field label="Alamat" error={err}>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={PLACEHOLDER[kind]}
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </Field>
          <Field label="Catatan (opsional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} className={inputCls} />
          </Field>
          <div className="flex gap-3">
            <Button type="submit" disabled={!name.trim() || !address.trim()}>
              Simpan
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Batal
            </Button>
          </div>
        </form>
      ) : (
        <Button onClick={() => open()}>
          <AddressBook /> Tambah kontak
        </Button>
      )}

      {contacts.length > 6 && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama" className={inputCls} />}

      {contacts.length === 0 ? (
        <Notice>Belum ada kontak.</Notice>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {shown.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <WalletAvatar seed={c.address} label={c.name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm text-zinc-100">
                  {c.name}
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">{KIND_NAME[c.kind]}</span>
                </p>
                <p className="truncate font-mono text-xs text-zinc-500">{shortAddr(c.address)}</p>
                {c.note && <p className="truncate text-xs text-zinc-600">{c.note}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <CopyButton text={c.address} />
                <button type="button" onClick={() => open(c)} aria-label={`Ubah ${c.name}`} className="p-2 text-zinc-500 transition-colors duration-300 hover:text-zinc-100">
                  <PencilSimple />
                </button>
                {confirmId === c.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      removeContact(c.id);
                      setConfirmId(null);
                    }}
                    className="rounded-lg border border-rose-400/30 px-2 py-1 text-rose-300"
                  >
                    Hapus?
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmId(c.id)} aria-label={`Hapus ${c.name}`} className="p-2 text-zinc-500 transition-colors duration-300 hover:text-rose-300">
                    <Trash />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
