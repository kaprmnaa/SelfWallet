import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CHAINS, type ChainConfig } from "../lib/chains";
import { sanitizeStored } from "../lib/customChains";
import type { TokenInfo } from "../lib/tokens";
import { load, save } from "../lib/storage";

export type HistoryItem = {
  hash: string;
  chainId: number;
  from: string;
  to: string;
  amount: string;
  symbol: string;
  ts: number;
  status: "pending" | "success" | "failed";
};

type Prefs = { chainId: number; testMode: boolean };
const DEFAULT_PREFS: Prefs = { chainId: 11155111, testMode: true }; // default ke testnet

type Ctx = {
  chain: ChainConfig;
  testMode: boolean;
  setChainId: (id: number) => void;
  setTestMode: (testMode: boolean) => void;
  chains: ChainConfig[]; // bawaan + kustom
  addCustomChain: (c: ChainConfig) => void;
  removeCustomChain: (chainId: number) => void;
  tokens: TokenInfo[]; // token pada chain aktif
  allTokens: Record<string, TokenInfo[]>; // semua chain (untuk portofolio)
  addToken: (t: TokenInfo) => void;
  removeToken: (address: string) => void;
  history: HistoryItem[];
  addHistory: (h: HistoryItem) => void;
  setHistoryStatus: (hash: string, status: HistoryItem["status"]) => void;
};

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [customChains, setCustomChains] = useState<ChainConfig[]>(() => {
    const seen = new Set<number>();
    return load<unknown[]>("chains", [])
      .map(sanitizeStored)
      .filter((c): c is ChainConfig => {
        if (!c || seen.has(c.chainId)) return false;
        seen.add(c.chainId);
        return true;
      });
  });
  const chains = useMemo(() => [...CHAINS, ...customChains], [customChains]);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = load<Prefs>("prefs", DEFAULT_PREFS);
    return [...CHAINS, ...customChains].some((c) => c.chainId === p.chainId) ? p : DEFAULT_PREFS;
  });
  const [tokenMap, setTokenMap] = useState<Record<string, TokenInfo[]>>(() => load("tokens", {}));
  const [history, setHistory] = useState<HistoryItem[]>(() => load("history", []));

  useEffect(() => save("prefs", prefs), [prefs]);
  useEffect(() => save("tokens", tokenMap), [tokenMap]);
  useEffect(() => save("history", history), [history]);
  useEffect(() => save("chains", customChains), [customChains]);

  const chain = chains.find((c) => c.chainId === prefs.chainId) ?? CHAINS[0];

  const setChainId = useCallback((id: number) => setPrefs((p) => ({ ...p, chainId: id })), []);
  const setTestMode = useCallback(
    (testMode: boolean) => {
      const first = chains.find((c) => c.testnet === testMode)!;
      setPrefs({ testMode, chainId: first.chainId });
    },
    [chains],
  );

  const addCustomChain = useCallback((c: ChainConfig) => {
    setCustomChains((l) => (l.some((x) => x.chainId === c.chainId) ? l : [...l, c]));
    setPrefs({ testMode: c.testnet, chainId: c.chainId });
  }, []);

  const removeCustomChain = useCallback((chainId: number) => {
    setCustomChains((l) => l.filter((c) => c.chainId !== chainId));
    setTokenMap((m) => {
      const { [String(chainId)]: _removed, ...rest } = m;
      return rest;
    });
    setPrefs((p) => (p.chainId === chainId ? DEFAULT_PREFS : p));
  }, []);

  const tokens = useMemo(() => tokenMap[String(chain.chainId)] ?? [], [tokenMap, chain.chainId]);

  const addToken = useCallback(
    (t: TokenInfo) =>
      setTokenMap((m) => {
        const k = String(chain.chainId);
        const list = m[k] ?? [];
        if (list.some((x) => x.address === t.address)) return m;
        return { ...m, [k]: [...list, t] };
      }),
    [chain.chainId],
  );
  const removeToken = useCallback(
    (address: string) =>
      setTokenMap((m) => {
        const k = String(chain.chainId);
        return { ...m, [k]: (m[k] ?? []).filter((x) => x.address !== address) };
      }),
    [chain.chainId],
  );

  const addHistory = useCallback((h: HistoryItem) => setHistory((l) => [h, ...l].slice(0, 100)), []);
  const setHistoryStatus = useCallback(
    (hash: string, status: HistoryItem["status"]) =>
      setHistory((l) => l.map((x) => (x.hash === hash ? { ...x, status } : x))),
    [],
  );

  const value = useMemo<Ctx>(
    () => ({
      chain,
      testMode: prefs.testMode,
      setChainId,
      setTestMode,
      chains,
      addCustomChain,
      removeCustomChain,
      tokens,
      allTokens: tokenMap,
      addToken,
      removeToken,
      history,
      addHistory,
      setHistoryStatus,
    }),
    [chain, prefs.testMode, setChainId, setTestMode, chains, addCustomChain, removeCustomChain, tokens, tokenMap, addToken, removeToken, history, addHistory, setHistoryStatus],
  );
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error("useSettings harus di dalam SettingsProvider");
  return c;
}
