"use client";

/** 琴面音位：七弦十三徽全览，点哪听哪。 */

import { FeatureShell } from "@/components/feature-shell";
import { QinBoard } from "@/components/qin-board";

export default function QinBoardPage() {
  return (
    <FeatureShell
      title="琴面音位全览"
      description="七弦、十三徽，点一下听这个位置的实际音高；按住拖动可以听走手音的变化。这里只做查音位，不打谱。"
    >
      <QinBoard />
    </FeatureShell>
  );
}
