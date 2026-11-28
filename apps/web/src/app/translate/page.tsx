"use client";

/** 简谱转减字：独立的录入工具页。确认后把谱字带回打谱工作台。 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FeatureShell } from "@/components/feature-shell";
import { JianpuTranslator } from "@/components/jianpu-translator";
import { JianziCodeImport } from "@/components/jianzi-code-import";
import { queueNotesForWorkbench } from "@/lib/workbench-bridge";
import type { NoteColumn } from "@/lib/types";

const TAB_CLASS = (active: boolean) =>
  `min-h-[36px] rounded border px-3 py-1.5 text-[12px] tracking-wider transition-colors ${
    active
      ? "border-amber-600/60 bg-amber-800/25 text-amber-900"
      : "border-amber-700/25 text-stone-600 hover:border-amber-600/60"
  }`;

export default function TranslatePage() {
  const router = useRouter();
  const [tab, setTab] = useState<"jianpu" | "code">("jianpu");

  const bringBack = (notes: NoteColumn[]) => {
    queueNotesForWorkbench(notes);
    router.push("/");
  };

  return (
    <FeatureShell
      title="简谱转减字"
      description="把 5 6 1 2 3 这样的数字变成减字谱：每个候选都给出指法取舍理由。确认后回到打谱工作台继续编辑。"
    >
      <div className="mb-4 flex items-center gap-2" role="tablist" aria-label="录入方式">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "jianpu"}
          onClick={() => setTab("jianpu")}
          className={TAB_CLASS(tab === "jianpu")}
        >
          简谱数字
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "code"}
          onClick={() => setTab("code")}
          className={TAB_CLASS(tab === "code")}
        >
          减字文本码
        </button>
      </div>
      {tab === "jianpu" ? (
        <JianpuTranslator onSelect={bringBack} />
      ) : (
        <JianziCodeImport onImport={bringBack} />
      )}
    </FeatureShell>
  );
}
