import type { HDKey } from "@scure/bip32";
import type { ChainConfig } from "../../lib/chains";
import type { Account } from "../../lib/vault";
import { btcAccountNode, btcAddressAt, btcNet, getSeed, type BtcNet } from "../../core/derive";
import { addressStats, addressUtxos } from "./esplora";

/**
 * Gap limit: berhenti memindai setelah 10 alamat berurutan tanpa riwayat (standar umum: 20).
 * Dikurangi agar permintaan ke penyedia data lebih sedikit. Jika wallet ini pernah dipakai di
 * aplikasi lain dengan celah alamat lebih dari 10, saldo bisa tampak lebih kecil. Ubah di sini.
 */
export const GAP_LIMIT = 10;

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

async function scanBranch(chain: ChainConfig, node: HDKey, net: BtcNet, branch: 0 | 1) {
  const used: { index: number; address: string; balance: bigint }[] = [];
  let lastUsed = -1;
  let index = 0;
  while (index - lastUsed <= GAP_LIMIT) {
    const batch = Array.from({ length: GAP_LIMIT }, (_, i) => btcAddressAt(node, net, branch, index + i));
    const stats = await mapLimit(batch, 5, (a) => addressStats(chain, a.address));
    stats.forEach((s, i) => {
      const c = s.chain_stats;
      const m = s.mempool_stats;
      if (c.tx_count + m.tx_count > 0) {
        lastUsed = index + i;
        const balance = BigInt(c.funded_txo_sum + m.funded_txo_sum - c.spent_txo_sum - m.spent_txo_sum);
        used.push({ index: index + i, address: batch[i].address, balance });
      }
    });
    index += GAP_LIMIT;
  }
  return { lastUsed, used };
}

async function doScan(chain: ChainConfig, node: HDKey, net: BtcNet, ownerKey: string): Promise<BtcScan> {
  const rx = await scanBranch(chain, node, net, 0);
  // Kembalian hanya bisa ada jika alamat terima sudah pernah dipakai: lewati cabang 1 untuk wallet kosong (hemat 10 permintaan).
  const ch = rx.lastUsed < 0 ? { lastUsed: -1, used: [] as { index: number; address: string; balance: bigint }[] } : await scanBranch(chain, node, net, 1);
  const withBalance = [
    ...rx.used.filter((u) => u.balance > 0n).map((u) => ({ ...u, branch: 0 as const })),
    ...ch.used.filter((u) => u.balance > 0n).map((u) => ({ ...u, branch: 1 as const })),
  ];
  const lists = await mapLimit(withBalance, 4, (a) => addressUtxos(chain, a.address));
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

const TTL = 60_000;
const STALE_OK_MS = 10 * 60_000;
const cache = new Map<string, { at: number; p: Promise<BtcScan> }>();
const lastGood = new Map<string, BtcScan>();

function keyOf(chain: ChainConfig, ownerKey: string) {
  return `${chain.chainId}:${ownerKey}`;
}

/** Pindai alamat terima + kembalian. Hasil di-cache 30 dtk dan permintaan serentak digabung. */
export async function scanBtc(chain: ChainConfig, account: Account, force = false): Promise<BtcScan | null> {
  const seed = getSeed(account);
  if (!seed) return null;
  const net = btcNet(chain.testnet);
  const node = btcAccountNode(seed, net);
  const ownerKey = btcAddressAt(node, net, 0, 0).address;
  const key = keyOf(chain, ownerKey);
  // Tampilan boleh memakai data lama saat penyedia gagal; pembelanjaan (force) tidak pernah.
  const orStale = (p: Promise<BtcScan>) =>
    force
      ? p
      : p.catch((e) => {
          const g = lastGood.get(key);
          if (g && Date.now() - g.scannedAt < STALE_OK_MS) return { ...g, stale: true };
          throw e;
        });
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL) return orStale(hit.p);
  const p = doScan(chain, node, net, ownerKey);
  cache.set(key, { at: Date.now(), p });
  p.then((s) => lastGood.set(key, s)).catch(() => cache.delete(key));
  return orStale(p);
}

export function invalidateBtc(chain: ChainConfig, ownerKey: string) {
  cache.delete(keyOf(chain, ownerKey));
}
