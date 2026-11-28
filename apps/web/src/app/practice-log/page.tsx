"use client";

/** 练琴日志：打卡、计时与周月统计。点卡点句回工作台练。 */

import { useRouter } from "next/navigation";
import { FeatureShell } from "@/components/feature-shell";
import { PracticeLogPanel } from "@/components/practice-log-panel";
import { queuePhraseForWorkbench } from "@/lib/workbench-bridge";

export default function PracticeLogPage() {
  const router = useRouter();
  return (
    <FeatureShell
      title="练琴日志"
      description="记下今天练了多久、练了什么；周月统计都在本机。工作台里的慢练卡点也会记在这里。"
    >
      <PracticeLogPanel
        onPracticePhrase={(index) => {
          queuePhraseForWorkbench(index);
          router.push("/");
        }}
      />
    </FeatureShell>
  );
}
