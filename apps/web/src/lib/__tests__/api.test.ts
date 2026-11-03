import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** 构造一个 fetch 的 Response 替身（jsdom 的 Response 对 204/无体较挑剔，直接给可控对象）。 */
function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? "",
    json: async () => body,
  } as unknown as Response;
}

/** 构造一个「body 不是 JSON」的错误响应，用于验证 statusText 兜底。 */
function textResponse(status: number, statusText: string) {
  return {
    ok: false,
    status,
    statusText,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("api: scores CRUD", () => {
  it("createScore POSTs title+notes（未指定定弦时落正调）", async () => {
    const created = {
      id: "s1",
      title: "流水",
      notes: [],
      tuning: "zhengdiao",
      created_at: "t",
      updated_at: "t",
    };
    fetchMock.mockResolvedValue(jsonResponse(created));
    const { createScore } = await import("@/lib/api");

    const notes = [{ id: "n1" }] as never;
    const result = await createScore("流水", notes);

    expect(result).toEqual(created);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/scores");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    // 定弦必须随谱一起提交：它决定这套减字弹出来是哪个音
    expect(JSON.parse(options.body)).toEqual({ title: "流水", notes, tuning: "zhengdiao" });
  });

  it("createScore 带署名时去空白后一并提交", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "s3", tuning: "zhengdiao" }));
    const { createScore } = await import("@/lib/api");

    await createScore("平沙落雁", [], "zhengdiao", "  张百忍  ");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).author).toBe("张百忍");
  });

  it("署名为空白时不提交 author 字段（走后端默认匿名）", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "s4", tuning: "zhengdiao" }));
    const { createScore } = await import("@/lib/api");

    await createScore("平沙落雁", [], "zhengdiao", "   ");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("author");
  });

  it("createScore 指定定弦时原样提交（蕤宾调）", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "s2", tuning: "ruibin" }));
    const { createScore } = await import("@/lib/api");

    await createScore("紧五弦", [], "ruibin");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tuning).toBe("ruibin");
  });

  it("listScores GETs the collection without a body", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: "s1", tuning: "ruibin" }]));
    const { listScores } = await import("@/lib/api");

    const result = await listScores();

    expect(result).toEqual([{ id: "s1", tuning: "ruibin" }]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/scores");
    expect(options?.method).toBeUndefined();
  });

  it("后端给出不认识的定弦时退回正调，不让坏值流到音高推算里", async () => {
    // 手工改库 / 老接口都可能给出意料外的字符串；
    // 让它一路走到 openMidi[index] 只会拿到 undefined。
    fetchMock.mockResolvedValue(jsonResponse([{ id: "s1", tuning: "youma" }]));
    const { listScores } = await import("@/lib/api");

    expect(await listScores()).toEqual([{ id: "s1", tuning: "zhengdiao" }]);
  });

  it("getScore puts the id in the path (no query string leakage)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "abc-123" }));
    const { getScore } = await import("@/lib/api");

    await getScore("abc-123");

    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/scores/abc-123");
  });

  it("updateScore PUTs only the provided fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "s1", title: "新标题" }));
    const { updateScore } = await import("@/lib/api");

    await updateScore("s1", { title: "新标题" });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/scores/s1");
    expect(options.method).toBe("PUT");
    expect(JSON.parse(options.body)).toEqual({ title: "新标题" });
  });

  it("deleteScore resolves on the backend's {deleted:true} 200 body", async () => {
    // 回归护栏：后端 delete 返回 200 + JSON（不是 204）。若后端改成 204，
    // handleResponse 里的 res.json() 会抛错，这条测试会立刻变红。
    fetchMock.mockResolvedValue(jsonResponse({ deleted: true }));
    const { deleteScore } = await import("@/lib/api");

    await expect(deleteScore("s1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});

describe("api: error mapping", () => {
  it("surfaces the backend's error message and status as ApiError", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "not found" }, { status: 404 }));
    const { getScore, ApiError } = await import("@/lib/api");

    await expect(getScore("missing")).rejects.toMatchObject({
      name: "ApiError",
      message: "not found",
      status: 404,
    });
    await expect(getScore("missing")).rejects.toBeInstanceOf(ApiError);
  });

  it("falls back to statusText when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(textResponse(502, "Bad Gateway"));
    const { listScores } = await import("@/lib/api");

    await expect(listScores()).rejects.toMatchObject({
      status: 502,
      message: "Bad Gateway",
    });
  });

  it("keeps status 503 distinct so callers can detect 'LLM 未配置'", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "LLM 未配置（缺少 ANTHROPIC_API_KEY）" }, { status: 503 }),
    );
    const { recognizeJianzi } = await import("@/lib/api");

    await expect(recognizeJianzi("b64", "image/png")).rejects.toMatchObject({ status: 503 });
  });
});

describe("api: translate & recognize contracts", () => {
  it("selectCandidates POSTs notes+tuning and passes the method through", async () => {
    const payload = { method: "heuristic", selections: [{ note_index: 0, candidate_index: 0, reason: "top1" }] };
    fetchMock.mockResolvedValue(jsonResponse(payload));
    const { selectCandidates } = await import("@/lib/api");

    const result = await selectCandidates([{ number: 1, octave: 0 }], "正调");

    expect(result).toEqual(payload);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/translate/select");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ notes: [{ number: 1, octave: 0 }], tuning: "正调" });
  });

  it("recognizeJianzi sends image_base64 + media_type and returns the recognition", async () => {
    const payload = { method: "llm", glyph: "散挑一", explanation: "左散右挑下弦一", confidence: 0.9 };
    fetchMock.mockResolvedValue(jsonResponse(payload));
    const { recognizeJianzi } = await import("@/lib/api");

    const result = await recognizeJianzi("QUJD", "image/jpeg");

    expect(result).toEqual(payload);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/jianzi/recognize");
    // 端点后缀必须精确：/recognize-sheet 与 /recognize 只差后缀，错了会静默识别错页
    expect(url.endsWith("/api/v1/jianzi/recognize")).toBe(true);
    expect(JSON.parse(options.body)).toEqual({ image_base64: "QUJD", media_type: "image/jpeg" });
  });

  it("recognizeJianziSheet hits the sheet endpoint and keeps row/col coordinates", async () => {
    const payload = {
      method: "llm",
      cells: [{ row: 0, col: 1, glyph: "大九勾四", explanation: null, confidence: 0.7 }],
    };
    fetchMock.mockResolvedValue(jsonResponse(payload));
    const { recognizeJianziSheet } = await import("@/lib/api");

    const result = await recognizeJianziSheet("QUJD", "image/png");

    expect(result.cells[0]).toMatchObject({ row: 0, col: 1, glyph: "大九勾四" });
    const url = fetchMock.mock.calls[0][0];
    expect(url.endsWith("/api/v1/jianzi/recognize-sheet")).toBe(true);
  });
});

describe("api: translate api-key gate", () => {
  it("omits x-api-key when NEXT_PUBLIC_TRANSLATE_API_KEY is unset", async () => {
    delete process.env.NEXT_PUBLIC_TRANSLATE_API_KEY;
    fetchMock.mockResolvedValue(jsonResponse({ method: "heuristic", selections: [] }));
    const { selectCandidates } = await import("@/lib/api");

    await selectCandidates([], "正调");

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("x-api-key");
  });

  it("attaches x-api-key when NEXT_PUBLIC_TRANSLATE_API_KEY is set", async () => {
    process.env.NEXT_PUBLIC_TRANSLATE_API_KEY = "test-key";
    try {
      fetchMock.mockResolvedValue(jsonResponse({ method: "heuristic", selections: [] }));
      const { selectCandidates } = await import("@/lib/api");

      await selectCandidates([], "正调");

      expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ "x-api-key": "test-key" });
    } finally {
      delete process.env.NEXT_PUBLIC_TRANSLATE_API_KEY;
    }
  });
});

describe("api: timeout", () => {
  it("aborts the request after the 10s budget instead of hanging forever", async () => {
    vi.useFakeTimers();
    let abortSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          abortSignal = options.signal ?? undefined;
          options.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const { listScores } = await import("@/lib/api");

    const pending = listScores();
    const assertion = expect(pending).rejects.toThrow(/abort/i);
    await vi.advanceTimersByTimeAsync(10_001);

    await assertion;
    expect(abortSignal?.aborted).toBe(true);
  });
});

describe("api: 后端地址解析（运行时 > 环境变量 > 无）", () => {
  afterEach(() => {
    window.localStorage.clear();
    delete process.env.NEXT_PUBLIC_API_URL;
  });

  it("无配置时 getApiBase 为 null，且 localhost 下 isBrowserOnlyMode 走服务器", async () => {
    const { getApiBase, isBrowserOnlyMode } = await import("@/lib/api");
    expect(getApiBase()).toBeNull();
    // jsdom hostname 默认 localhost → 视为开发环境，可走服务器路径
    expect(isBrowserOnlyMode()).toBe(false);
  });

  it("运行时设置优先于构建期环境变量", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://env.example.com";
    window.localStorage.setItem("taiyin.apiBaseUrl", "https://runtime.example.com");
    const { getApiBase } = await import("@/lib/api");
    expect(getApiBase()).toBe("https://runtime.example.com");
  });

  it("仅环境变量时取环境变量", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://env.example.com";
    const { getApiBase } = await import("@/lib/api");
    expect(getApiBase()).toBe("https://env.example.com");
  });

  it("运行时设置后 isBrowserOnlyMode 为 false（社区可达，不受部署域名影响）", async () => {
    window.localStorage.setItem("taiyin.apiBaseUrl", "https://runtime.example.com");
    const { isBrowserOnlyMode } = await import("@/lib/api");
    expect(isBrowserOnlyMode()).toBe(false);
  });
});
