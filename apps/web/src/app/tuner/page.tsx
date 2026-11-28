"use client";

/** 调音 / 定弦：麦克风校弦与调式切换，自读全局定弦 store。 */

import { FeatureShell } from "@/components/feature-shell";
import { TunerPanel } from "@/components/tuner-panel";

export default function TunerPage() {
  return (
    <FeatureShell
      title="调音与定弦"
      description="用麦克风校弦，或者换一个调式。定弦决定每个减字反推出来的音高，换调后工作台里的播放与导出会跟着变。"
    >
      <TunerPanel />
    </FeatureShell>
  );
}
