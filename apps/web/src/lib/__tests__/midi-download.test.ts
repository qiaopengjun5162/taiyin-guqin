/**
 * @vitest-environment jsdom
 */
/**
 * `downloadMidi` 只在浏览器里成立（要 Blob / createObjectURL / <a download>），
 * 所以单独放一个 jsdom 环境的文件，别把 node 环境里的 SMF 字节校验拖下水。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadMidi } from "../midi-export";

const clicked: string[] = [];

beforeEach(() => {
  clicked.length = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:midi"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  // jsdom 不实现真正的下载，只记录被点过的 download 属性
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this.download);
  });
});

describe("downloadMidi", () => {
  it("点到一个带 .mid 扩展名的链接上", () => {
    downloadMidi(Uint8Array.from([0x4d, 0x54]), "良宵引");
    expect(clicked).toEqual(["良宵引.mid"]);
  });

  it("已经带 .mid 就不重复加", () => {
    downloadMidi(Uint8Array.from([0x4d, 0x54]), "流水.mid");
    expect(clicked).toEqual(["流水.mid"]);
  });

  it("下载后不会在 DOM 里留下野节点，并释放 blob url", async () => {
    downloadMidi(Uint8Array.from([1, 2, 3]), "test");
    expect(document.querySelectorAll("a")).toHaveLength(0);
    // revoke 走 setTimeout(0)，等一个宏任务
    await new Promise((r) => setTimeout(r, 5));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:midi");
  });
});
