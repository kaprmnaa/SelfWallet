import { Lock } from "@phosphor-icons/react";
import { lockMessage } from "../goals/logic";
import type { Goal } from "../goals/types";
import { Notice } from "./ui";

/** Ditampilkan di panel Kirim/Swap saat goal aktif mengunci penarikan di jaringan ini. */
export default function GoalLockNotice({ goal }: { goal: Goal }) {
  return (
    <Notice>
      <Lock className="mr-2 inline" />
      {lockMessage(goal)}
    </Notice>
  );
}
