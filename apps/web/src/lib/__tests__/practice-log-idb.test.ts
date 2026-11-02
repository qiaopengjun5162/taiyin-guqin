/**
 * @vitest-environment jsdom
 */
/**
 * 练琴记录的「真·IndexedDB」路径。
 *
 * jsdom 没有 IndexedDB，`practice-log.test.ts` 里跑的都是内存兜底分支；
 * 这里用一个最小替身把 open → upgrade → transaction 打通，
 * 专门覆盖「能持久化」的那一半（以及打开失败时如何优雅退回内存）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  __resetPracticeStoreForTests,
  addEntry,
  deleteEntry,
  deleteRecording,
  getRecordingBlob,
  isPersistentStorage,
  listEntries,
  listRecordings,
  renameRecording,
  saveRecording,
  updateEntryNote,
} from "../practice-log";

type Row = Record<string, unknown> & { id: string };

/** IDBRequest 的最小替身：结果同步可取，回调异步触发。 */
interface FakeRequest<T> {
  result: T;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  onblocked: (() => void) | null;
}

function makeRequest<T>(result: T, fail = false): FakeRequest<T> {
  const r: FakeRequest<T> = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    onblocked: null,
  };
  setTimeout(() => {
    if (fail) {
      r.error = new Error("IndexedDB 操作失败");
      r.onerror?.();
    } else {
      r.onsuccess?.();
    }
  }, 0);
  return r;
}

/** 打开数据库的请求：一次回调里决定「先升级再成功」还是「直接失败」。 */
function makeOpenRequest<T>(result: T, failOpen: boolean): FakeRequest<T> {
  const r: FakeRequest<T> = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    onblocked: null,
  };
  setTimeout(() => {
    if (failOpen) {
      r.error = new Error("被拒绝");
      r.onerror?.();
      return;
    }
    r.onupgradeneeded?.();
    r.onsuccess?.();
  }, 0);
  return r;
}

interface FakeStore {
  getAll: () => FakeRequest<Row[]>;
  get: (k: string) => FakeRequest<Row | undefined>;
  put: (v: Row) => FakeRequest<string>;
  delete: (k: string) => FakeRequest<undefined>;
}

interface FakeDb {
  objectStoreNames: { contains: (n: string) => boolean };
  createObjectStore: (n: string) => unknown;
  transaction: () => { objectStore: (n: string) => FakeStore };
}

function makeDb(opts: { failWrites: boolean; throwOnTransaction?: boolean }): FakeDb {
  const stores = new Map<string, Map<string, Row>>();
  return {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore: (n) => {
      stores.set(n, new Map());
      return {};
    },
    transaction: () => {
      if (opts.throwOnTransaction) throw new Error("被别的标签页锁住了");
      return {
        objectStore: (n) => {
          const store = stores.get(n);
          if (!store) throw new Error(`没有 ${n} 这个 store`);
          return {
            getAll: () => makeRequest([...store.values()], opts.failWrites),
            get: (k) => makeRequest(store.get(k), opts.failWrites),
            put: (v: Row) => {
              if (!opts.failWrites) store.set(v.id, v);
              return makeRequest(v.id, opts.failWrites);
            },
            delete: (k) => {
              if (!opts.failWrites) store.delete(k);
              return makeRequest(undefined, opts.failWrites);
            },
          };
        },
      };
    },
  };
}

function installFakeIndexedDB(
  opts: {
    failOpen?: boolean;
    throwOnOpen?: boolean;
    failWrites?: boolean;
    throwOnTransaction?: boolean;
  } = {},
) {
  const db = makeDb({
    failWrites: !!opts.failWrites,
    throwOnTransaction: opts.throwOnTransaction,
  });
  const open = vi.fn(() => {
    if (opts.throwOnOpen) throw new Error("SecurityError");
    return makeOpenRequest(db, !!opts.failOpen);
  });
  vi.stubGlobal("indexedDB", { open });
  return open;
}

beforeEach(() => {
  __resetPracticeStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetPracticeStoreForTests();
});

describe("IndexedDB 可用时", () => {
  it("如实报告「能持久化」，并按 version 1 打好库", async () => {
    const open = installFakeIndexedDB();
    expect(await isPersistentStorage()).toBe(true);
    expect(open).toHaveBeenCalledWith("taiyin.practice", 1);
  });

  it("增删改查都真的走库", async () => {
    installFakeIndexedDB();

    const created = await addEntry({ scoreTitle: "良宵引", seconds: 300, source: "timer" });
    expect(created.source).toBe("timer");

    let list = await listEntries();
    expect(list).toHaveLength(1);
    expect(list[0].scoreTitle).toBe("良宵引");

    await updateEntryNote(created.id, " 第三段换气 ");
    list = await listEntries();
    expect(list[0].note).toBe("第三段换气");

    await deleteEntry(created.id);
    expect(await listEntries()).toHaveLength(0);
  });

  it("改不存在的记录、改删不存在的录音都不炸", async () => {
    installFakeIndexedDB();
    await expect(updateEntryNote("查无此条", "x")).resolves.toBeUndefined();
    await expect(renameRecording("查无此录音", "x")).resolves.toBeUndefined();
    await expect(deleteRecording("查无此录音")).resolves.toBeUndefined();
  });

  it("录音元信息与 Blob 分两个 store 存，列表不夹带音频", async () => {
    installFakeIndexedDB();
    const blob = new Blob(["take-1"], { type: "audio/webm" });
    const meta = await saveRecording({ blob, seconds: 12, scoreTitle: "流水" });

    const list = await listRecordings();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("流水");

    const back = await getRecordingBlob(meta.id);
    expect(await back!.text()).toBe("take-1");
  });
});

describe("IndexedDB 不可用时退回内存", () => {
  it("打开报错（隐私模式）→ 不声称持久，但本次会话照常可写", async () => {
    installFakeIndexedDB({ failOpen: true });
    expect(await isPersistentStorage()).toBe(false);

    await addEntry({ scoreTitle: "平沙落雁", seconds: 60 });
    expect((await listEntries())[0].scoreTitle).toBe("平沙落雁");
  });

  it("indexedDB.open 直接抛异常也能兜住", async () => {
    installFakeIndexedDB({ throwOnOpen: true });
    expect(await isPersistentStorage()).toBe(false);
  });

  it("事务被占住（onblocked / 抛错）→ 退回内存", async () => {
    installFakeIndexedDB({ throwOnTransaction: true });
    const created = await addEntry({ scoreTitle: "梅花三弄", seconds: 90 });
    expect(created.scoreTitle).toBe("梅花三弄");
    expect((await listEntries())[0].id).toBe(created.id);
  });

  it("写入失败时录音也退到内存，能读回同一段", async () => {
    installFakeIndexedDB({ failWrites: true });
    const blob = new Blob(["内存里的录音"], { type: "audio/webm" });
    const meta = await saveRecording({ blob, seconds: 5 });

    expect((await listRecordings())[0].id).toBe(meta.id);
    const back = await getRecordingBlob(meta.id);
    expect(await back!.text()).toBe("内存里的录音");
  });
});
