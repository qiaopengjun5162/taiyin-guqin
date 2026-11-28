"use client";

/** 设置：社区后端地址与账号。纯配置页，与打谱工作台互不干扰。 */

import { FeatureShell } from "@/components/feature-shell";
import { BackendSettings } from "@/components/backend-settings";

export default function SettingsPage() {
  return (
    <FeatureShell
      title="设置 · 社区后端与账号"
      description="填社区后端地址，登录或注册。不填也能用：打谱、播放、导出与本机保存全部离线可用。"
    >
      <BackendSettings />
    </FeatureShell>
  );
}
