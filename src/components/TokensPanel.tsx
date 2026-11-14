import { useEffect, useState, type FormEvent } from "react";
import { m } from "framer-motion";
import { formatUnits } from "ethers";
import { Coins, Trash } from "@phosphor-icons/react";
import type { ChainConfig } from "../lib/chains";
import { useSettings } from "../context/SettingsContext";
import { PRESETS, fetchTokenInfo, tokenBalance, type TokenInfo } from "../lib/tokens";
import { errMsg, shortAddr, trimAmount } from "../lib/format";
import CoinIcon from "./CoinIcon";
import { Button, Field, Notice, Skeleton, inputCls, spring } from "./ui";

function TokenRow({ token, chain, owner, onRemove }: { token: TokenInfo; chain: ChainConfig; owner: string; onRemove: () => void }) {
  const [bal, setBal] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    let alive = true;
    tokenBalance(chain, token, owner)
      .then((b) => alive && setBal(trimAmount(formatUnits(b, token.decimals), 6)))
      .catch(() => alive && setBad(true));
    return () => {
      alive = false;
    };
  }, [chain, token, owner]);

  return (
    <m.li
      layout
      variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: spring } }}
      exit={{ opacity: 0, x: -12 }}
      className="flex items-center justify-between gap-4 py-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        <CoinIcon symbol={token.symbol} size={32} />
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-100">
            {token.symbol} <span className="text-zinc-500">· {token.name}</span>
          </p>
          <p className="font-mono text-xs text-zinc-600">{shortAddr(token.address)}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {bad ? (
          <span className="text-xs text-rose-400">gagal memuat</span>
        ) : bal === null ? (
          <Skeleton className="h-4 w-16" />
        ) : (
          <span className="font-mono text-sm text-zinc-100">{bal}</span>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Hapus ${token.symbol}`}
          className="grid size-8 place-items-center rounded-lg text-zinc-600 transition-colors duration-300 hover:bg-white/5 hover:text-rose-300"
        >
          <Trash />
        </button>
      </div>
    </m.li>
  );
}

export default function TokensPanel({ chain, owner }: { chain: ChainConfig; owner: string }) {
  const { tokens, addToken, removeToken } = useSettings();
  const [addr, setAddr] = useState("");
  const [err, setErr] = useState("");
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<TokenInfo | null>(null);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setFound(null);
    setLooking(true);
    try {
      const info = await fetchTokenInfo(chain, addr);
      if (tokens.some((t) => t.address === info.address)) throw new Error("Token ini sudah ada di daftar.");
      setFound(info);
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setLooking(false);
    }
  }

  async function quickAdd(symbol: string, address: string) {
    setErr("");
    setFound(null);
    setLooking(true);
    try {
      const info = await fetchTokenInfo(chain, address);
      if (info.symbol.toUpperCase() !== symbol) {
        throw new Error(`Contract di alamat ini melapor simbol "${info.symbol}", bukan ${symbol}. Dibatalkan demi keamanan.`);
      }
      setAddr(info.address);
      setFound(info);
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setLooking(false);
    }
  }

  const presets = (PRESETS[chain.chainId] ?? []).filter(
    (p) => !tokens.some((t) => t.address.toLowerCase() === p.address.toLowerCase()),
  );

  return (
    <div className="grid gap-8">
      {tokens.length === 0 ? (
        <div className="flex items-start gap-4 border-y border-white/[0.06] py-8">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 text-zinc-500">
            <Coins />
          </span>
          <div>
            <p className="text-sm text-zinc-200">Belum ada token di {chain.name}</p>
            <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-zinc-500">
              Tempel alamat contract ERC-20 di bawah. Aplikasi memeriksa bahwa contract itu ada dan menjawab name,
              symbol, dan decimals sebelum Anda menambahkannya.
            </p>
          </div>
        </div>
      ) : (
        <m.ul
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
          className="divide-y divide-white/[0.06] border-y border-white/[0.06]"
        >
          {tokens.map((t) => (
            <TokenRow key={t.address} token={t} chain={chain} owner={owner} onRemove={() => removeToken(t.address)} />
          ))}
        </m.ul>
      )}

      {presets.length > 0 && (
        <div className="grid gap-3">
          <p className="text-xs font-medium tracking-wide text-zinc-400">Tambah cepat</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Button key={p.address} type="button" variant="ghost" busy={looking} onClick={() => quickAdd(p.symbol, p.address)} className="!px-4 !py-2.5">
                {p.symbol}
              </Button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={lookup} className="grid gap-4">
        <Field label="Alamat contract token" error={err}>
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} font-mono`}
          />
        </Field>
        <Button type="submit" variant="ghost" disabled={!addr} busy={looking}>
          {looking ? "Memeriksa contract…" : "Periksa token"}
        </Button>
      </form>

      {found && (
        <div className="grid gap-4 border-t border-white/[0.06] pt-6">
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-y-2 text-sm">
            <dt className="text-zinc-500">Nama</dt>
            <dd className="text-zinc-100">{found.name}</dd>
            <dt className="text-zinc-500">Simbol</dt>
            <dd className="text-zinc-100">{found.symbol}</dd>
            <dt className="text-zinc-500">Decimals</dt>
            <dd className="font-mono text-zinc-100">{found.decimals}</dd>
            <dt className="text-zinc-500">Contract</dt>
            <dd className="break-all font-mono text-xs text-zinc-300">{found.address}</dd>
          </dl>
          <Notice>
            Siapa pun bisa membuat token dengan nama dan simbol yang sama. Cocokkan alamat contract dengan sumber
            resmi proyeknya sebelum menambahkan.
          </Notice>
          <Button
            onClick={() => {
              addToken(found);
              setFound(null);
              setAddr("");
            }}
          >
            Tambahkan {found.symbol}
          </Button>
        </div>
      )}
    </div>
  );
}
