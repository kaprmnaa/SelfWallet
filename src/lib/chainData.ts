import { useEffect, useMemo, useRef, useState } from "react";
import { formatEther, formatUnits } from "ethers";
import { kindOf, type ChainConfig } from "./chains";
import { withProvider } from "./rpc";
import { useVisibleInterval } from "./visibility";
import { errMsg } from "./format";
import { explainError } from "./explain";
import type { Account } from "./vault";
import { NEED_PHRASE, btcAccountNode, btcAddressAt, btcNet, getSeed, solAccount } from "../core/derive";
import { scanBtc } from "../chains/bitcoin/account";
import { solBalance } from "../chains/solana/rpc";

type Identity = { address: string; owner: string } | { unsupported: string } | { fail: string };

/** Alamat dan identitas dihitung LOKAL (tanpa jaringan), jadi tetap tampil walau penyedia data gagal. */
function identity(chain: ChainConfig, account: Account): Identity {
  try {
    const kind = kindOf(chain);
    if (kind === "btc") {
      const seed = getSeed(account);
      if (!seed) return { unsupported: NEED_PHRASE };
      const net = btcNet(chain.testnet);
      const a = btcAddressAt(btcAccountNode(seed, net), net, 0, 0).address;
      return { address: a, owner: a };
    }
    if (kind === "sol") {
      const s = solAccount(account);
      if (!s) return { unsupported: NEED_PHRASE };
      return { address: s.address, owner: s.address };
    }
    return { address: account.address, owner: account.address };
  } catch (e) {
    return { fail: `Derivasi alamat gagal: ${errMsg(e)}` };
  }
}

type Loaded = { address: string; balance: string; pending: string | null; note: string | null };

async function load(chain: ChainConfig, account: Account, force: boolean, fallbackAddress: string, deep: boolean): Promise<Loaded> {
  const kind = kindOf(chain);
  if (kind === "btc") {
    const scan = await scanBtc(chain, account, { force, deep });
    if (!scan) throw new Error(NEED_PHRASE);
    return {
      address: scan.receiveAddress,
      balance: formatUnits(scan.total, 8),
      pending: scan.unconfirmed > 0n ? formatUnits(scan.unconfirmed, 8) : null,
      note: scan.stale ? "Menampilkan data terakhir yang berhasil dimuat; penyedia data sedang tidak merespons." : null,
    };
  }
  if (kind === "sol") {
    return { address: fallbackAddress, balance: formatUnits(await solBalance(chain, fallbackAddress), 9), pending: null, note: null };
  }
  const b = await withProvider(chain, (p) => p.getBalance(account.address));
  return { address: account.address, balance: formatEther(b), pending: null, note: null };
}

type State = { key: string; loading: boolean; data: Loaded | null; error: string | null };

export type ChainData = {
  loading: boolean;
  /** Galat pemuatan saldo, lengkap dengan penyebabnya (host, status HTTP, dst). */
  error: string | null;
  unsupported: string | null;
  note: string | null;
  /** Alamat terima (BTC: alamat berikutnya yang belum dipakai; sebelum pemindaian: alamat indeks 0). */
  address: string;
  /** Identitas stabil wallet pada jaringan ini (kunci riwayat). */
  owner: string;
  balance: string | null;
  pending: string | null;
  refresh: () => void;
  /** Bitcoin: pindai ulang dengan gap 20 (lebih banyak permintaan ke penyedia data). */
  deepScan: () => void;
};

/** Saldo + alamat untuk jaringan aktif (EVM, Bitcoin, atau Solana). */
export function useChainData(chain: ChainConfig, account: Account): ChainData {
  const key = `${chain.chainId}:${account.address}`;
  const ident = useMemo(() => identity(chain, account), [chain, account]);
  const [state, setState] = useState<State>({ key, loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  const force = useRef(false);
  const deepRef = useRef(false);
  const usable = "address" in ident;
  const fallbackAddress = usable ? ident.address : "";

  useEffect(() => {
    if (!usable) {
      setState({ key, loading: false, data: null, error: null });
      return;
    }
    let alive = true;
    const f = force.current;
    const d = deepRef.current;
    force.current = false;
    deepRef.current = false;
    load(chain, account, f, fallbackAddress, d)
      .then((r) => alive && setState({ key, loading: false, data: r, error: null }))
      .catch((e) => {
        if (!alive) return;
        setState((s) => ({
          key,
          loading: false,
          data: s.key === key ? s.data : null,
          error: `Saldo gagal dimuat: ${explainError(e).slice(0, 400)}`,
        }));
      });
    return () => {
      alive = false;
    };
  }, [chain, account, key, tick, usable, fallbackAddress]);

  useVisibleInterval(() => setTick((t) => t + 1), 30_000);

  const cur: State = state.key === key ? state : { key, loading: true, data: null, error: null };
  return {
    loading: cur.loading,
    error: "fail" in ident ? ident.fail : cur.error,
    unsupported: "unsupported" in ident ? ident.unsupported : null,
    note: cur.data?.note ?? null,
    address: cur.data?.address ?? (usable ? ident.address : ""),
    owner: usable ? ident.owner : "",
    balance: cur.data?.balance ?? null,
    pending: cur.data?.pending ?? null,
    refresh: () => {
      force.current = true;
      setTick((t) => t + 1);
    },
    deepScan: () => {
      deepRef.current = true;
      force.current = true;
      setTick((t) => t + 1);
    },
  };
}
