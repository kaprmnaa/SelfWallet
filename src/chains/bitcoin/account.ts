import type { HDKey } from "@scure/bip32";
import type { ChainConfig } from "../../lib/chains";
import type { Account } from "../../lib/vault";
import { load, save } from "../../lib/storage";
import { btcAccountNode, btcAddressAt, btcNet, getSeed, type BtcNet } from "../../core/derive";
import { addressStats, addressUtxos } from "./esplora";
import { hintCandidates, missingWindow, type Hint } from "./gap";

/**
 * Gap limit. Pemindaian BIASA memakai gap 3 (hemat permintaan; dompet ini selalu memakai alamat berikutnya yang
 * belum terpakai, jadi celah praktis tidak ada). Jika wallet ini pernah dipakai di aplikasi lain dengan celah alamat
 * lebih besar, jalankan "Pindai mendalam" (gap 20, standar BIP-44), yang mengabaikan petunjuk tersimpan.
 */
export const GAP_QUICK = 3;
export const GAP_DEEP = 20;

export type BtcUtxo = {
  txid: string;
  vout: number;
  value: bigint;
  confirmed: boolean;
  branch: 0 | 1;
  index: number;
  address: string;
};

export type BtcScan = {
  net: BtcNet;
  /** Alamat terima berikutnya yang belum dipakai. */
  receiveAddress: string;
  /** Alamat kembalian berikutnya yang belum dipakai. */
  changeAddress: string;
  changeIndex: number;
  /** Alamat indeks 0 (identitas stabil wallet ini untuk riwayat). */
  ownerKey: string;
  utxos: BtcUtxo[];
  confirmed: bigint;
  unconfirmed: bigint;
  total: bigint;
  scannedAt: number;
  /** true = data lama (penyedia sedang gagal); hanya untuk tampilan, tidak pernah dipakai untuk membelanjakan. */
  stale?: boolean;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

type Branch = { lastUsed: number; used: { index: number; address: string; balance: bigint }[]; funded: number[] };

async function scanBranch(
  chain: ChainConfig,
  node: HDKey,
  net: BtcNet,
  branch: 0 | 1,
  gap: number,
  hint?: Hint,
): Promise<Branch> {
  const info = new Map<number, { address: string; used: boolean; balance: bigint }>();
  let lastUsed = -1;

  const check = async (indices: number[]) => {
    const todo = indices.filter((i) => !info.has(i));
    const addrs = todo.map((i) => btcAddressAt(node, net, branch, i));
    const stats = await mapLimit(addrs, 3, (a) => addressStats(chain, a.address));
    stats.forEach((s, k) => {
      const c = s.chain_stats;
      const m = s.mempool_stats;
      const used = c.tx_count + m.tx_count > 0;
      const balance = BigInt(c.funded_txo_sum + m.funded_txo_sum - c.spent_txo_sum - m.spent_txo_sum);
      info.set(todo[k], { address: addrs[k].address, used, balance });
      if (used) lastUsed = Math.max(lastUsed, todo[k]);
    });
  };

  // 1) alamat yang diketahui aktif dari pemindaian sebelumnya (jika ada)
  const known = hintCandidates(hint);
  if (known.length > 0) await check(known);
  // 2) jendela gap setelah alamat terakhir yang dipakai, sampai stabil
  for (;;) {
    const need = missingWindow(new Set(info.keys()), lastUsed, gap);
    if (need.length === 0) break;
    await check(need);
  }

  const used = [...info.entries()].filter(([, v]) => v.used).map(([index, v]) => ({ index, address: v.address, balance: v.balance }));
  return { lastUsed, used, funded: used.filter((u) => u.balance > 0n).map((u) => u.index) };
}

type Hints = { rx: Hint; ch: Hint };
const hintKey = (chain: ChainConfig, owner: string) => `btc-hint:${chain.chainId}:${owner}`;

async function doScan(chain: ChainConfig, node: HDKey, net: BtcNet, ownerKey: string, deep: boolean): Promise<BtcScan> {
  const gap = deep ? GAP_DEEP : GAP_QUICK;
  const hints = deep ? undefined : (load<Hints | null>(hintKey(chain, ownerKey), null) ?? undefined);

  const rx = await scanBranch(chain, node, net, 0, gap, hints?.rx);
  // Kembalian hanya bisa ada jika alamat terima sudah pernah dipakai: lewati cabang 1 untuk wallet kosong.
  const ch: Branch =
    rx.lastUsed < 0 ? { lastUsed: -1, used: [], funded: [] } : await scanBranch(chain, node, net, 1, gap, hints?.ch);

  const withBalance = [
    ...rx.used.filter((u) => u.balance > 0n).map((u) => ({ ...u, branch: 0 as const })),
    ...ch.used.filter((u) => u.balance > 0n).map((u) => ({ ...u, branch: 1 as const })),
  ];
  const lists = await mapLimit(withBalance, 3, (a) => addressUtxos(chain, a.address));
  const utxos: BtcUtxo[] = [];
  withBalance.forEach((a, i) => {
    for (const u of lists[i]) {
      utxos.push({
        txid: u.txid,
        vout: u.vout,
        value: BigInt(u.value),
        confirmed: !!u.status?.confirmed,
        branch: a.branch,
        index: a.index,
        address: a.address,
      });
    }
  });
  let confirmed = 0n;
  let unconfirmed = 0n;
  for (const u of utxos) (u.confirmed ? (confirmed += u.value) : (unconfirmed += u.value));

  // simpan petunjuk (hanya indeks, non-rahasia) untuk pemindaian berikutnya yang lebih hemat
  save(hintKey(chain, ownerKey), {
    rx: { last: rx.lastUsed, funded: rx.funded },
    ch: { last: ch.lastUsed, funded: ch.funded },
  } satisfies Hints);

  const changeIndex = ch.lastUsed + 1;
  return {
    net,
    receiveAddress: btcAddressAt(node, net, 0, rx.lastUsed + 1).address,
    changeAddress: btcAddressAt(node, net, 1, changeIndex).address,
    changeIndex,
    ownerKey,
    utxos,
    confirmed,
    unconfirmed,
    total: confirmed + unconfirmed,
    scannedAt: Date.now(),
  };
}

const TTL = 120_000;
const STALE_OK_MS = 15 * 60_000;
const cache = new Map<string, { at: number; p: Promise<BtcScan> }>();
const lastGood = new Map<string, BtcScan>();

function keyOf(chain: ChainConfig, ownerKey: string) {
  return `${chain.chainId}:${ownerKey}`;
}

type ScanOpts = { force?: boolean; deep?: boolean };

/**
 * Pindai alamat terima + kembalian. Hasil di-cache 2 menit dan permintaan serentak digabung.
 * `force` (dipakai saat membelanjakan) melewati cache dan TIDAK pernah memakai data lama.
 */
export async function scanBtc(chain: ChainConfig, account: Account, opts: boolean | ScanOpts = false): Promise<BtcScan | null> {
  const o: ScanOpts = typeof opts === "boolean" ? { force: opts } : opts;
  const force = !!o.force || !!o.deep;
  const seed = getSeed(account);
  if (!seed) return null;
  const net = btcNet(chain.testnet);
  const node = btcAccountNode(seed, net);
  const ownerKey = btcAddressAt(node, net, 0, 0).address;
  const key = keyOf(chain, ownerKey);

  // Tampilan boleh memakai data lama saat penyedia gagal; pembelanjaan (force) tidak pernah.
  const orStale = (p: Promise<BtcScan>) =>
    o.force || o.deep
      ? p
      : p.catch((e) => {
          const g = lastGood.get(key);
          if (g && Date.now() - g.scannedAt < STALE_OK_MS) return { ...g, stale: true };
          throw e;
        });

  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL) return orStale(hit.p);
  const p = doScan(chain, node, net, ownerKey, !!o.deep);
  cache.set(key, { at: Date.now(), p });
  p.then((s) => lastGood.set(key, s)).catch(() => cache.delete(key));
  return orStale(p);
}

export function invalidateBtc(chain: ChainConfig, ownerKey: string) {
  cache.delete(keyOf(chain, ownerKey));
}
