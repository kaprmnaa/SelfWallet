import { Lock } from "@phosphor-icons/react";
import { fmtPool } from "../goals/guard";
import { lockMessage } from "../goals/logic";
import { timeLockMessage } from "../goals/timelock";
import type { LockInfo } from "../goals/useLock";
import type { ChainConfig } from "../lib/chains";
import { Notice } from "./ui";

/** Ditampilkan di panel Kirim/Swap saat kunci waktu atau goal lock membatasi penarikan di jaringan ini. */
export default function GoalLockNotice({ info, chain }: { info: LockInfo; chain: ChainConfig }) {
  let text: string;
  if (info.time) text = timeLockMessage(info.time);
  else if (info.whole) text = lockMessage(info.whole);
  else if (info.summary) {
    const s = info.summary;
    text = `Hanya dana yang tidak terkunci yang bisa ditarik. Terkunci ${fmtPool(s.locked, s.currency, chain.symbol)} · bisa ditarik ${fmtPool(s.free, s.currency, chain.symbol)} (total ${fmtPool(s.total, s.currency, chain.symbol)}).`;
  } else {
    text = "Sebagian dana terkunci oleh goal lock. Hanya dana yang tidak terkunci yang bisa ditarik (dicek saat Anda mengonfirmasi).";
  }
  return (
    <Notice>
      <Lock className="mr-2 inline" />
      {text}
    </Notice>
  );
}
