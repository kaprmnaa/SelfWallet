import type { ChainConfig } from "../../lib/chains";
import { hostOf } from "../../lib/explain";

/**
 * Penyedia data Zcash (UTXO, tinggi blok, status, siaran). Dua jenis API dikenali dari URL dasarnya:
 *  - Blockchair  : https://api.blockchair.com/zcash   (bawaan)
 *  - Blockbook   : server Blockbook Zcash mana pun (/api/v2/...), mis. milik Anda sendiri
 * Catatan privasi: alamat Anda dikirim ke penyedia data, sehingga penyedia bisa mengaitkan alamat dan IP Anda.
 */
export type ZUtxoInfo = { txid: string; vout: number; value: bigint; confirmed: boolean };
export type ZBalance = { utxos: ZUtxoInfo[]; confirmed: bigint; unconfirmed: bigint; total: bigint };

const isBlockchair = (base: string) => /(^|\/\/|\.)blockchair\.com(\/|$)/i.test(base);

class HttpErr extends Error {
  constructor(
    public status: number,
    host: string,
    body: string,
  ) {
    super(`${host}: HTTP ${status}${body ? ` (${body.slice(0, 100)})` : ""}`);
  }
}

async function http(url: string, init: RequestInit = {}): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, referrerPolicy: "no-referrer" });
    const text = await r.text();
    if (!r.ok) throw new HttpErr(r.status, hostOf(url), text);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${hostOf(url)}: jawaban bukan JSON.`);
    }
  } finally {
    clearTimeout(t);
  }
}

/** Coba tiap endpoint berurutan; galat 404 dikembalikan apa adanya supaya pemanggil bisa menafsirkannya. */
async function withBases<T>(chain: ChainConfig, fn: (base: string, bc: boolean) => Promise<T>): Promise<T> {
  const errs: string[] = [];
  for (const base of chain.rpcUrls) {
    try {
      return await fn(base, isBlockchair(base));
    } catch (e) {
      if (e instanceof HttpErr && e.status === 404) throw e;
      errs.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`Semua endpoint Zcash gagal: ${errs.join("; ")}`);
}

/* ------------------------------------------------------------------ UTXO */

type BcAddress = {
  data: Record<string, { address?: { balance?: number; unspent_output_count?: number }; utxo?: { block_id: number; transaction_hash: string; index: number; value: number }[] }>;
};
type BbUtxo = { txid: string; vout: number; value: string; confirmations?: number; height?: number }[];

const TTL = 20_000;
const cache = new Map<string, { at: number; p: Promise<ZBalance> }>();

async function fetchBalance(chain: ChainConfig, address: string): Promise<ZBalance> {
  const utxos = await withBases(chain, async (base, bc) => {
    if (bc) {
      const j = (await http(`${base}/dashboards/address/${address}`)) as BcAddress;
      const d = Object.values(j.data ?? {})[0];
      if (!d) return [] as ZUtxoInfo[];
      const list = d.utxo ?? [];
      // Daftar UTXO dari Blockchair dibatasi jumlahnya: jangan menghitung saldo dari data yang terpotong.
      const expected = d.address?.unspent_output_count ?? list.length;
      if (expected > list.length) throw new Error(`UTXO terlalu banyak (${expected}) untuk dipindai penyedia ini. Gunakan server Blockbook sendiri.`);
      return list.map((u) => ({ txid: u.transaction_hash, vout: u.index, value: BigInt(u.value), confirmed: u.block_id > 0 }));
    }
    const j = (await http(`${base}/api/v2/utxo/${address}`)) as BbUtxo;
    if (!Array.isArray(j)) throw new Error("Jawaban Blockbook tidak dikenal.");
    return j.map((u) => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value), confirmed: (u.confirmations ?? 0) > 0 }));
  });
  let confirmed = 0n;
  let unconfirmed = 0n;
  for (const u of utxos) (u.confirmed ? (confirmed += u.value) : (unconfirmed += u.value));
  return { utxos, confirmed, unconfirmed, total: confirmed + unconfirmed };
}

/** `force` (dipakai saat membelanjakan) melewati cache. Permintaan serentak digabung. */
export function zecBalance(chain: ChainConfig, address: string, force = false): Promise<ZBalance> {
  const key = `${chain.chainId}:${address}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.p;
  const p = fetchBalance(chain, address);
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}
export const invalidateZec = (chain: ChainConfig, address: string) => cache.delete(`${chain.chainId}:${address}`);

/* ------------------------------------------------------- tip, status, siaran */

export async function zecTip(chain: ChainConfig): Promise<number> {
  const n = await withBases(chain, async (base, bc) => {
    if (bc) {
      const j = (await http(`${base}/stats`)) as { data?: { blocks?: number } };
      return Number(j.data?.blocks);
    }
    const j = (await http(`${base}/api/v2`)) as { backend?: { blocks?: number }; blockbook?: { bestHeight?: number } };
    return Number(j.backend?.blocks ?? j.blockbook?.bestHeight);
  });
  if (!Number.isInteger(n) || n <= 0) throw new Error("Tinggi blok Zcash tidak valid.");
  return n;
}

export async function zecTxStatus(chain: ChainConfig, txid: string): Promise<"pending" | "success"> {
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) throw new Error("txid tidak valid.");
  try {
    return await withBases(chain, async (base, bc) => {
      if (bc) {
        const j = (await http(`${base}/dashboards/transaction/${txid}`)) as { data?: Record<string, { transaction?: { block_id?: number } } | undefined> };
        const t = Object.values(j.data ?? {})[0]?.transaction;
        return t && Number(t.block_id) > 0 ? "success" : "pending"; // belum terindeks / di mempool = pending
      }
      const j = (await http(`${base}/api/v2/tx/${txid}`)) as { blockHeight?: number; confirmations?: number };
      return (j.confirmations ?? 0) > 0 || Number(j.blockHeight) > 0 ? "success" : "pending";
    });
  } catch (e) {
    if (e instanceof HttpErr && e.status === 404) return "pending";
    throw e;
  }
}

/** Siarkan transaksi bertanda tangan (hex). Mengembalikan txid dari penyedia. */
export async function zecBroadcast(chain: ChainConfig, hex: string): Promise<string> {
  if (!/^[0-9a-f]+$/i.test(hex)) throw new Error("Transaksi tidak valid.");
  return withBases(chain, async (base, bc) => {
    if (bc) {
      const j = (await http(`${base}/push/transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${hex}`,
      })) as { data?: { transaction_hash?: string }; context?: { error?: string } };
      const id = j.data?.transaction_hash;
      if (!id) throw new Error(j.context?.error ?? "Penyedia menolak transaksi.");
      return id;
    }
    const j = (await http(`${base}/api/v2/sendtx/`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: hex })) as {
      result?: string;
      error?: string;
    };
    if (!j.result) throw new Error(j.error ?? "Penyedia menolak transaksi.");
    return j.result;
  });
}
