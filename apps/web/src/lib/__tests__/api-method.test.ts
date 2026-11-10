import { describe, expect, it } from "vitest";
import type { RecognizeJianziResponse } from "../api";

/**
 * 前后端契约护栏：`method` 的取值集合必须与后端一致。
 *
 * 后端 `routes.rs::template_response` 会返回 `method: "template"`（模板匹配路径），
 * `jianzi-recognizer.tsx` 也确实按 `"template"` 分支显示「本机模板匹配」。
 * 接口一旦漏掉它，TypeScript 不会报错——窄的值能赋给宽的 state，
 * 只有有人写穷尽 `switch` 时才会静默漏分支。这条用类型注解钉住。
 */
describe("RecognizeJianziResponse.method 契约", () => {
  it("必须允许后端模板路径返回的 template", () => {
    const method: RecognizeJianziResponse["method"] = "template";
    expect(method).toBe("template");
  });

  it("必须允许 llm 与 unavailable", () => {
    const methods: RecognizeJianziResponse["method"][] = [
      "llm",
      "unavailable",
      "template",
    ];
    expect(methods).toHaveLength(3);
  });
});
