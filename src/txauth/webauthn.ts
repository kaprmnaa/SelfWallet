/**
 * WebAuthn untuk konfirmasi kirim (2FA): pendaftaran passkey platform (ES256) dan verifikasi LOKAL assertion.
 * Tanpa dependensi eksternal supaya mudah diuji. Verifikasi memeriksa tanda tangan P-256, flag UP+UV, rpIdHash,
 * origin, jenis, dan challenge; jadi yang diterima adalah bukti bahwa autentikator memverifikasi pengguna
 * (Face ID / Touch ID) untuk permintaan INI, bukan sekadar "browser mengembalikan sesuatu".
 */

export type TxAuthErrorCode = "cancelled" | "unsupported" | "failed" | "verify";
export class TxAuthError extends Error {
  constructor(
    public code: TxAuthErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64u = (u: Uint8Array) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const bs = (u: Uint8Array) => u as unknown as BufferSource;
const sha256 = async (u: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", bs(u)));
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** Tanda tangan ECDSA DER (format WebAuthn) -> r||s 64 byte (format WebCrypto). */
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2) throw new TxAuthError("verify", "Tanda tangan passkey tidak valid.");
  let i = 2;
  const read = () => {
    if (der[i] !== 0x02) throw new TxAuthError("verify", "Tanda tangan passkey tidak valid.");
    const len = der[i + 1];
    let n = der.slice(i + 2, i + 2 + len);
    if (n.length !== len) throw new TxAuthError("verify", "Tanda tangan passkey tidak valid.");
    i += 2 + len;
    while (n.length > 32 && n[0] === 0) n = n.slice(1);
    if (n.length > 32) throw new TxAuthError("verify", "Tanda tangan passkey tidak valid.");
    const out = new Uint8Array(32);
    out.set(n, 32 - n.length);
    return out;
  };
  const r = read();
  const s = read();
  if (i !== der.length) throw new TxAuthError("verify", "Tanda tangan passkey tidak valid.");
  const raw = new Uint8Array(64);
  raw.set(r);
  raw.set(s, 32);
  return raw;
}

export type AssertionInput = {
  /** Kunci publik SPKI (DER) yang disimpan saat pendaftaran. */
  pub: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  /** Challenge yang kita kirim. */
  challenge: Uint8Array;
  rpId: string;
  origin: string;
};

export async function verifyAssertion(a: AssertionInput): Promise<void> {
  const bad = (m: string) => new TxAuthError("verify", m);
  let cd: { type?: unknown; challenge?: unknown; origin?: unknown };
  try {
    cd = JSON.parse(new TextDecoder().decode(a.clientDataJSON));
  } catch {
    throw bad("Data konfirmasi passkey rusak.");
  }
  if (cd.type !== "webauthn.get") throw bad("Jenis konfirmasi passkey salah.");
  if (cd.challenge !== b64u(a.challenge)) throw bad("Konfirmasi passkey tidak cocok dengan permintaan ini.");
  if (cd.origin !== a.origin) throw bad("Asal konfirmasi passkey tidak cocok.");

  const ad = a.authenticatorData;
  if (ad.length < 37) throw bad("Data autentikator rusak.");
  if (!eq(ad.slice(0, 32), await sha256(new TextEncoder().encode(a.rpId)))) throw bad("Domain konfirmasi passkey tidak cocok.");
  const flags = ad[32];
  if (!(flags & 0x01)) throw bad("Kehadiran pengguna tidak terkonfirmasi.");
  if (!(flags & 0x04)) throw bad("Verifikasi biometrik/perangkat tidak terkonfirmasi.");

  const signed = new Uint8Array(ad.length + 32);
  signed.set(ad);
  signed.set(await sha256(a.clientDataJSON), ad.length);
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("spki", bs(a.pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, bs(derToRaw(a.signature)), bs(signed));
  } catch (e) {
    if (e instanceof TxAuthError) throw e;
  }
  if (!ok) throw bad("Tanda tangan passkey tidak valid.");
}

function mapError(e: unknown): TxAuthError {
  if (e instanceof TxAuthError) return e;
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return new TxAuthError("cancelled", "Dibatalkan.");
  if (name === "NotSupportedError" || name === "SecurityError" || name === "InvalidStateError") {
    return new TxAuthError("unsupported", "Perangkat atau browser ini belum mendukung passkey (butuh HTTPS dan iCloud Keychain aktif).");
  }
  return new TxAuthError("failed", "Konfirmasi passkey gagal.");
}

/** Daftarkan passkey platform (ES256). Panggil LANGSUNG dari gestur sentuhan (sebelum await apa pun). */
export async function enrollPasskey(label: string): Promise<{ cred: Uint8Array; pub: Uint8Array }> {
  try {
    const c = (await navigator.credentials.create({
      publicKey: {
        rp: { name: "Kunci", id: location.hostname },
        user: { id: rnd(16), name: label, displayName: label },
        challenge: rnd(32),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
        attestation: "none",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    const r = c?.response as AuthenticatorAttestationResponse | undefined;
    const pub = r?.getPublicKey?.();
    if (!c || !r || !pub || r.getPublicKeyAlgorithm?.() !== -7) throw new TxAuthError("unsupported", "Passkey di perangkat ini tidak bisa dipakai untuk konfirmasi kirim.");
    return { cred: new Uint8Array(c.rawId), pub: new Uint8Array(pub) };
  } catch (e) {
    throw mapError(e);
  }
}

/** Minta konfirmasi Face ID/Touch ID lalu verifikasi hasilnya secara lokal. Panggil dari gestur sentuhan. */
export async function confirmWithPasskey(cred: Uint8Array, pub: Uint8Array): Promise<void> {
  const challenge = rnd(32);
  let res: PublicKeyCredential | null;
  try {
    res = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname,
        allowCredentials: [{ type: "public-key", id: bs(cred), transports: ["internal"] }],
        userVerification: "required",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw mapError(e);
  }
  const r = res?.response as AuthenticatorAssertionResponse | undefined;
  if (!r) throw new TxAuthError("failed", "Konfirmasi passkey gagal.");
  await verifyAssertion({
    pub,
    authenticatorData: new Uint8Array(r.authenticatorData),
    clientDataJSON: new Uint8Array(r.clientDataJSON),
    signature: new Uint8Array(r.signature),
    challenge,
    rpId: location.hostname,
    origin: location.origin,
  });
}
