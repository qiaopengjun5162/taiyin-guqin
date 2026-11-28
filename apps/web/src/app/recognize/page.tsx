"use client";

/** 减字图片识别：单字与整页两种用法各占一个 tab。 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FeatureShell } from "@/components/feature-shell";
import { JianziRecognizer } from "@/components/jianzi-recognizer";
import { JianziSheetRecognizer } from "@/components/jianzi-sheet-recognizer";
import { queueNotesForWorkbench } from "@/lib/workbench-bridge";
import type { NoteColumn } from "@/lib/types";

const TAB_CLASS = (active: boolean) =>
  `min-h-[36px] rounded border px-3 py-1.5 text-[12px] tracking-wider transition-colors ${
    active
      ? "border-amber-600/60 bg-amber-800/25 text-amber-900"
      : "border-amber-700/25 text-stone-600 hover:border-amber-600/60"
  }`;

export default function RecognizePage() {
  const router = useRouter();
  const [tab, setTab] = useState<"single" | "sheet">("single");

  const bringBack = (notes: NoteColumn[]) => {
    queueNotesForWorkbench(notes);
    router.push("/");
  };

  return (
    <FeatureShell
      title="减字图片识别"
      description="上传一个字看看它怎么拆；整页识别目前只对常见单字可靠，认不全整首谱，结果需要逐字校对。校对完可以带回工作台。"
    >
      <div className="mb-4 flex items-center gap-2" role="tablist" aria-label="识别方式">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "single"}
          onClick={() => setTab("single")}
          className={TAB_CLASS(tab === "single")}
        >
          单字
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sheet"}
          onClick={() => setTab("sheet")}
          className={TAB_CLASS(tab === "sheet")}
        >
          整页
        </button>
      </div>
      {tab === "single" ? <JianziRecognizer /> : <JianziSheetRecognizer onImport={bringBack} />}
    </FeatureShell>
  );
}
