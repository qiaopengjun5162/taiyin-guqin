/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetCustomJianziForTests,
  exportSaved,
  getSavedSnapshot,
  importSaved,
  jianziKey,
  listSaved,
  removeSaved,
  saveJianzi,
  touchSaved,
} from "../custom-jianzi";
import type { JianziState } from "../types";

const anYin: JianziState = {
  toneType: "按",
  rhythmMode: null,
  leftFinger: "大",
  hui: "九",
  fen: null,
  slide: null,
  rightAction: "勾",
  stringNumber: "四",
};

const sanYin: JianziState = {
  toneType: "散",
  rhythmMode: null,
  leftFinger: null,
  hui: null,
  fen: null,
  slide: null,
  rightAction: "挑",
  stringNumber: "六",
};

beforeEach(() => {
  window.localStorage.clear();
  __resetCustomJianziForTests();
});

describe("我的减字 · 存取", () => {
  it("同一个减字签名一致，字段顺序不影响去重", () => {
    const reordered: JianziState = {
      stringNumber: "四",
      rightAction: "勾",
      slide: null,
      fen: null,
      hui: "九",
      leftFinger: "大",
      rhythmMode: null,
      toneType: "按",
    };
    expect(jianziKey(reordered)).toBe(jianziKey(anYin));
  });

  it("没填完的减字不入库", () => {
    const half: JianziState = { ...anYin, hui: null };
    expect(saveJianzi(half)).toBeNull();
    expect(listSaved()).toHaveLength(0);
  });

  it("存进去能读出来，默认名是它的读法", () => {
    const result = saveJianzi(anYin);
    expect(result?.isNew).toBe(true);
    expect(result?.item.label).toBe("大九勾四");
    expect(listSaved()).toHaveLength(1);
    expect(listSaved()[0].state).toEqual(anYin);
  });

  it("重复存同一个字不产生第二条，只把使用次数加上去", () => {
    saveJianzi(anYin);
    const again = saveJianzi(anYin);
    expect(again?.isNew).toBe(false);
    expect(listSaved()).toHaveLength(1);
    expect(listSaved()[0].uses).toBe(2);
  });

  it("用过的排在前面", () => {
    saveJianzi(anYin);
    const second = saveJianzi(sanYin)?.item;
    touchSaved(second!.id);
    touchSaved(second!.id);
    expect(listSaved()[0].key).toBe(jianziKey(sanYin));
  });

  it("删除之后就不在了", () => {
    const item = saveJianzi(anYin)!.item;
    removeSaved(item.id);
    expect(listSaved()).toHaveLength(0);
  });

  it("快照会随写入更新", () => {
    expect(getSavedSnapshot()).toHaveLength(0);
    saveJianzi(anYin);
    expect(getSavedSnapshot()).toHaveLength(1);
  });
});

describe("我的减字 · 导入导出", () => {
  it("导出的文件带版本号和条目", () => {
    saveJianzi(anYin);
    const parsed = JSON.parse(exportSaved());
    expect(parsed.version).toBe(1);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].label).toBe("大九勾四");
  });

  it("导入到空库：新增一条", () => {
    saveJianzi(anYin);
    const pack = exportSaved();
    window.localStorage.clear();
    __resetCustomJianziForTests();

    const result = importSaved(pack);
    expect(result).toMatchObject({ added: 1, updated: 0, skipped: 0 });
    expect(listSaved()).toHaveLength(1);
  });

  it("同一个包再导一次只合并不重复", () => {
    saveJianzi(anYin);
    const pack = exportSaved();
    const result = importSaved(pack);
    expect(result).toMatchObject({ added: 0, updated: 1 });
    expect(listSaved()).toHaveLength(1);
  });

  it("坏文件说清原因，不抛异常", () => {
    expect(importSaved("不是 json").error).toContain("JSON");
    expect(importSaved('{"foo":1}').error).toContain("items");
  });

  it("包里混着不完整的条目只跳过它", () => {
    const pack = JSON.stringify({
      version: 1,
      items: [
        { id: "a", label: "大九勾四", key: "x", uses: 1, createdAt: 1, state: anYin },
        { id: "b", label: "半截", key: "y", uses: 1, createdAt: 1, state: { toneType: "按" } },
      ],
    });
    const result = importSaved(pack);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("导入时按实际内容重算签名，不信文件里写的 key", () => {
    const pack = JSON.stringify({
      version: 1,
      items: [
        { id: "a", label: "冒名", key: "假的", uses: 3, createdAt: 1, state: anYin },
      ],
    });
    importSaved(pack);
    expect(listSaved()[0].key).toBe(jianziKey(anYin));
  });
});
