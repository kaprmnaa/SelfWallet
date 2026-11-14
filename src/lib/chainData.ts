import { useEffect, useRef, useState } from "react";
import { formatEther, formatUnits } from "ethers";
import { kindOf, type ChainConfig } from "./chains";
import { withProvider } from "./rpc";
import { useVisibleInterval } from "./visibility";
import type { Account } from "./vault";
import { NEED_PHRASE, solAccount } from "../core/derive";
import { scanBtc } from "../chains/bitcoin/account";
import { solBalance } from "../chains/solana/rpc";

type Loaded = { address: string; owner: string; balance: string; pending: string | null };

async function load(chain: ChainConfig, account: Account, force: boolean): Promise<Loaded | { unsupported: string }> {
  const kind = kindOf(chain);
  if (kind === "btc") {
    const scan = await scanBtc(chain, account, force);
    if (!scan) return { unsupported: NEED_PHRASE };
    return {
      address: scan.receiveAddress,
      owner: scan.ownerKey,
      balance: formatUnits(scan.total, 8),
      pending: scan.unconfirmed > 0n ? formatUnits(scan.unconfirmed, 8) : null,
    };
  }
  if (kind === "sol") {
    const sol = solAccount(account);
    if (!sol) return { unsupported: NEED_PHRASE };
    return { address: sol.address, owner: sol.address, balance: formatUnits(await solBalance(chain, sol.address), 9), pending: null };
  }
  const b = await withProvider(chain, (p) => p.getBalance(account.address));
  return { address: account.address, owner: account.address, balance: formatEther(b), pending: null };
}

type State = { key: string; loading: boolean; data: Loaded | null; unsupported: string | null; error: string | null };

export type ChainData = {
  loading: boolean;
  error: string | null;
  unsupported: string | null;
  /** Alamat yang ditampilkan/dipakai untuk menerima (BTC: alamat berikutnya yang belum dipakai). */
  address: string;
  /** Identitas stabil wallet pada jaringan ini (kunci riwayat). */
  owner: string;
  balance: string | null;
  pending: string | null;
  refresh: () => void;
};

/** Saldo + alamat untuk jaringan aktif (EVM, Bitcoin, atau Solana). */
export function useChainData(chain: ChainConfig, account: Account): ChainData {
  const key = `${chain.chainId}:${account.address}`;
  const [state, setState] = useState<State>({ key, loading: true, data: null, unsupported: null, error: null });
  const [tick, setTick] = useState(0);
  const force = useRef(false);

  useEffect(() => {
    let alive = true;
    const f = force.current;
    force.current = false;
    load(chain, account, f)
      .then((r) => {
        if (!alive) return;
        if ("unsupported" in r) setState({ key, loading: false, data: null, unsupported: r.unsupported, error: null });
        else setState({ key, loading: false, data: r, unsupported: null, error: null });
      })
      .catch(() => {
        if (!alive) return;
        setState((s) => ({
          key,
          loading: false,
          data: s.key === key ? s.data : null,
          unsupported: null,
          error: "Saldo gagal dimuat. Penyedia data tidak merespons.",
        }));
      });
    return () => {
      alive = false;
    };
  }, [chain, account, key, tick]);

  useVisibleInterval(() => setTick((t) => t + 1), 30_000);

  const cur: State = state.key === key ? state : { key, loading: true, data: null, unsupported: null, error: null };
  return {
    loading: cur.loading,
    error: cur.error,
    unsupported: cur.unsupported,
    address: cur.data?.address ?? "",
    owner: cur.data?.owner ?? "",
    balance: cur.data?.balance ?? null,
    pending: cur.data?.pending ?? null,
    refresh: () => {
      force.current = true;
      setTick((t) => t + 1);
    },
  };
}
