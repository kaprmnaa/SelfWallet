import { useSyncExternalStore } from "react";
import { load, save } from "../lib/storage";
import { isContact, validateContact, type Contact, type ContactKind } from "./logic";

const raw = load<unknown>("contacts", []);
let contacts: Contact[] = Array.isArray(raw) ? raw.filter(isContact) : [];
let strict = load<unknown>("contacts-strict", false) === true;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const getContacts = () => contacts;
export const getStrict = () => strict;
export const useContacts = () => useSyncExternalStore(subscribe, getContacts, getContacts);
export const useStrict = () => useSyncExternalStore(subscribe, getStrict, getStrict);

function commit(next: Contact[]) {
  contacts = next;
  save("contacts", contacts);
  emit();
}

export function addContact(input: { name: string; address: string; kind: ContactKind; note?: string }): Contact {
  const v = validateContact(contacts, input);
  const now = Date.now();
  const c: Contact = { id: crypto.randomUUID(), ...v, createdAt: now, updatedAt: now };
  commit([c, ...contacts]);
  return c;
}

export function updateContact(id: string, input: { name: string; address: string; kind: ContactKind; note?: string }) {
  const cur = contacts.find((c) => c.id === id);
  if (!cur) throw new Error("Kontak tidak ditemukan.");
  const v = validateContact(contacts, input, id);
  commit(contacts.map((c) => (c.id === id ? { ...c, ...v, updatedAt: Date.now() } : c)));
}

export function removeContact(id: string) {
  commit(contacts.filter((c) => c.id !== id));
}

export function setStrict(on: boolean) {
  strict = on;
  save("contacts-strict", on);
  emit();
}
