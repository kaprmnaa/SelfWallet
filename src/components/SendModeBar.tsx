import { useState } from "react";
import { Fingerprint } from "@phosphor-icons/react";
import type { Account } from "../lib/vault";
import { biometricName, useBiometricSupport } from "../lib/biometric";
import { errMsg } from "../lib/format";
import { disableTxAuth, enableTxAuth, setSendMode, useTxSettings, walletIdOf, type SendMode } from "../txauth/store";
import { TxAuthError } from "../txauth/webauthn";
import { Switch } from "./ui";

const MODES: { key: SendMode; label: string }[] = [
  { key: "review", label: "Tinjau" },
  { key: "fast", label: "Cepat" },
];

/** Pilih mode kirim (Tinjau / Cepat) dan aktifkan 2FA Face ID untuk kirim. Dipakai di semua panel Kirim. */
export default function SendModeBar({ account }: { account: Account }) {
  const id = walletIdOf(account);
  const s = useTxSettings(id);
  const bioOk = useBiometricSupport();
  const bioName = biometricName();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function toggleAuth() {
    setErr("");
    setBusy(true);
    try {
      // enableTxAuth memanggil WebAuthn sebagai langkah pertama: harus langsung dari gestur sentuhan.
      if (s.auth) await disableTxAuth(id);
      else await enableTxAuth(id, "Konfirmasi kirim");
    } catch (ex) {
      if (!(ex instanceof TxAuthError && ex.code === "cancelled")) setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="glass-field grid grid-cols-2 gap-1 rounded-xl border border-white/10 p-0.5 text-xs" role="group" aria-label="Mode kirim">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={s.mode === m.key}
              onClick={() => setSendMode(id, m.key)}
              className={`rounded-[10px] px-4 py-2 transition-colors duration-300 ${s.mode === m.key ? "glass-lens text-zinc-50" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {(bioOk || s.auth) && (
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <Fingerprint />
            {bioName}
            <Switch checked={s.auth} onChange={toggleAuth} label={`${bioName} untuk kirim`} disabled={busy} />
          </label>
        )}
      </div>
      {s.mode === "fast" && !s.auth && <p className="text-xs text-amber-300/80">Mode cepat tanpa {bioName}: sekali klik langsung terkirim.</p>}
      {err && (
        <p role="alert" className="text-xs text-rose-300">
          {err}
        </p>
      )}
    </div>
  );
}
