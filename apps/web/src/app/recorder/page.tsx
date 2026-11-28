"use client";

/** 录音回听：只留录音这一件事，不再和打卡统计挤一个折叠面板。 */

import { FeatureShell } from "@/components/feature-shell";
import { RecorderPanel } from "@/components/recorder-panel";

export default function RecorderPage() {
  return (
    <FeatureShell
      title="录音回听"
      description="把自己弹的录下来，立刻回听。录音会记进本机练习记录；想看打卡和统计，去「练琴日志」。"
    >
      <RecorderPanel scoreTitle="未命名曲谱" />
    </FeatureShell>
  );
}
