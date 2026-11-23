import { useMemo } from "react";
import { findContact, normalizeAddress, sameAddress, type Contact, type ContactKind } from "./logic";
import { useContacts, useStrict } from "./store";

export type RecipientInfo = {
  /** Alamat ternormalisasi jika valid, selain itu null. */
  norm: string | null;
  contact: Contact | undefined;
  isSelf: boolean;
  strict: boolean;
  /** Whitelist aktif dan penerima tidak diizinkan (kosong tidak dihitung). */
  blocked: boolean;
};

export function useRecipient(kind: ContactKind, to: string, self?: string | null): RecipientInfo {
  const contacts = useContacts();
  const strict = useStrict();
  return useMemo(() => {
    const t = to.trim();
    let norm: string | null = null;
    try {
      norm = t ? normalizeAddress(kind, t) : null;
    } catch {
      norm = null;
    }
    const contact = norm ? findContact(contacts, kind, norm) : undefined;
    const isSelf = !!norm && !!self && sameAddress(kind, norm, self);
    return { norm, contact, isSelf, strict, blocked: strict && !!t && !contact && !isSelf };
  }, [contacts, strict, kind, to, self]);
}
