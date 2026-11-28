"use client";

/** 跟录音练：导入音频 / AB 循环 / 变速。 */

import { FeatureShell } from "@/components/feature-shell";
import { PracticePlayer } from "@/components/practice-player";

export default function PracticeAudioPage() {
  return (
    <FeatureShell
      title="跟录音练"
      description="导入一段录音，用 AB 循环反复磨一句，调速到能跟上的速度。这里不碰曲谱，专心听和练。"
    >
      <PracticePlayer />
    </FeatureShell>
  );
}
