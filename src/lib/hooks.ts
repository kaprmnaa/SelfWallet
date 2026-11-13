import { useEffect, useState } from "react";
import { formatEther } from "ethers";
import type { ChainConfig } from "./chains";
import { withProvider } from "./rpc";
import { useVisibleInterval } from "./visibility";

type BalState = { key: string; loading: boolean; value: string | null; error: string | null };

export function useNativeBalance(chain: ChainConfig, address: string) {
  const key = `${chain.chainId}:${address}`;
  const [state, setState] = useState<BalState>({ key, loading: true, value: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    withProvider(chain, (p) => p.getBalance(address))
      .then((b) => alive && setState({ key, loading: false, value: formatEther(b), error: null }))
      .catch(
        () =>
          alive &&
          setState((s) => ({
            key,
            loading: false,
            value: s.key === key ? s.value : null,
            error: "Saldo gagal dimuat. RPC tidak merespons.",
          })),
      );
    return () => {
      alive = false;
    };
  }, [chain, address, key, tick]);

  useVisibleInterval(() => setTick((t) => t + 1), 30_000);

  // Ganti chain/akun: jangan tampilkan nilai milik chain sebelumnya.
  const current: BalState = state.key === key ? state : { key, loading: true, value: null, error: null };
  return { ...current, refresh: () => setTick((t) => t + 1) };
}
