import type { NoteColumn } from "./types";
import { DEFAULT_TUNING, isTuningId, type TuningId } from "./tuning";
import {
  localCreateScore,
  localDeleteScore,
  localGetScore,
  localListScores,
  localUpdateScore,
} from "./local-score-store";
import { getStoredApiBase } from "./settings";
import { getOwnerToken } from "./owner-token";
import { getSessionToken, setStoredSession, clearStoredSession, type SessionUser } from "./auth";

/** 本地曲谱读写：连后端时，首页「本机」tab 用它们直接操作浏览器存储，
 *  不走 api 的 server/browser 分支判断（否则本地 id 会被误发到服务器）。 */
export { localListScores, localGetScore, localDeleteScore };

/**
 * 解析后端地址：运行时设置（设置面板）> 构建期环境变量 > 无。
 * 做成函数而非模块级常量，因为运行时设置可能随时变（用户在设置里改了后端地址）。
 * 返回 null 表示「未配置后端」——此时退回本地存储。
 */
export function getApiBase(): string | null {
  const runtime = getStoredApiBase();
  if (runtime) return runtime;
  return process.env.NEXT_PUBLIC_API_URL || null;
}

/** 解析实际请求基址：有配置用配置，否则退回本机 3001（dev 约定）。 */
function resolveBase(): string {
  return getApiBase() ?? "http://localhost:3001";
}

/**
 * 纯前端模式：没有配置后端地址，且当前不在本机开发环境。
 *
 * GitHub Pages 这类静态托管没有 Rust 后端，此时若继续打 localhost:3001，
 * 保存 / 加载 / 识别全部必然失败。曲谱改为存浏览器本地，
 * 保证「拼—听—存—取」这条最基本的链路在线上可用。
 */
export function isBrowserOnlyMode(): boolean {
  // 运行时或构建期配置了后端地址 → 走服务器（社区 / 分享可达）
  if (getApiBase() !== null) return false;
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1";
}

/** 当前曲谱存储位置，供 UI 提示用。 */
export function scoreStorageMode(): "server" | "browser" {
  return isBrowserOnlyMode() ? "browser" : "server";
}
const DEFAULT_TIMEOUT = 10_000;

// 后端可选 API-key 闸门（纵深防御性设计）：配置后调用 /translate/select 需携带。
// 该 key 会出现在前端 JS 包中，仅用于阻止跨站/自动化滥用，并非机密。
const TRANSLATE_API_KEY = process.env.NEXT_PUBLIC_TRANSLATE_API_KEY;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (TRANSLATE_API_KEY) {
    headers["x-api-key"] = TRANSLATE_API_KEY;
  }
  return headers;
}

/**
 * 所有权凭证头：改 / 删社区曲谱时必须带上。
 *
 * **发布也必须带**（服务端 2026-11 起拒绝无身份发布，见 `create_score`）：
 * 不带凭证的请求会 401，因为那种谱会变成谁也改不掉、只能管理员进库清的死数据。
 * `getOwnerToken()` 首次调用就会生成并持久化，所以正常使用中用户感觉不到这一步。
 *
 * 登录后额外带上会话：服务端两条腿认一条即可（账号 OR 凭证），
 * 所以换设备登录之后，不再依赖这台机器上那把钥匙。
 */
function ownerHeaders(): Record<string, string> {
  const token = getOwnerToken();
  const session = getSessionToken();
  return {
    ...(token ? { "x-owner-token": token } : {}),
    ...(session ? { Authorization: `Bearer ${session}` } : {}),
  };
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** 静态站点没有后端时的识别提示（避免静默失败） */
const BROWSER_ONLY_RECOGNIZE_HINT =
  "识别功能需要后端服务。当前是纯前端版本（未连接后端），请在本机运行 just dev 后使用识别。";

async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeout = DEFAULT_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把后端错误响应翻成用户能照着做的一句话。
 *
 * 429 是唯一需要单独处理的：限流层直接返回**纯文本**（不是我们的 JSON 错误体），
 * 原样抛给用户等于没说——"Too Many Requests" 既不说原因也不说要等多久，
 * 用户只会立刻再点一次，然后继续失败。
 *
 * 服务端在 `retry-after` 里给了剩余秒数（CORS 已显式暴露该头，否则跨域读不到）。
 * 向上取整：提示「等 0 秒」比不提示更让人困惑。
 */
async function parseErrorMessage(res: Response): Promise<string> {
  if (res.status === 429) {
    const after = Number(res.headers.get("retry-after") ?? "");
    if (Number.isFinite(after) && after > 0) {
      return `操作太频繁，请 ${Math.ceil(after)} 秒后再试`;
    }
    return "操作太频繁，请稍后再试";
  }
  try {
    const body = await res.json();
    return (body as { error?: string }).error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json();
}

export interface ScoreListItem {
  id: string;
  title: string;
  /**
   * 该谱的定弦。后端总会给值（建表默认正调），
   * 但读端仍按 `isTuningId` 校验后再用——老接口/手工改库都可能给出意料外的字符串。
   */
  tuning: TuningId;
  /**
   * 打谱人署名。空串 = 匿名（迁移前的老谱、或发布时没填）。
   * 定为可选是因为「尚未升级的后端」不会返回该字段。
   */
  author?: string;
  /**
   * 收藏数（热度）。后端 0.29.0 起在列表项里返回；旧后端不返回，前端按 0 处理。
   * 定为可选同理——降级到旧后端时列表仍然能正常渲染，只是不显示热度。
   */
  favorites_count?: number;
  /**
   * 归属账号 id；`null` 表示还只是「某台设备用凭证发的」，没有账号归属。
   * 前端拿它与当前登录者比对，决定这首谱是不是「我的」。
   */
  owner_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Score extends ScoreListItem {
  notes: NoteColumn[];
  /**
   * 已被管理员下架。只有谱主和管理员能读到这份数据（外人拿到 id 是 404），
   * 所以这个字段唯独出现在「自己的谱被下架」这一种场景里——界面据此提示原因。
   */
  hidden?: boolean;
}

/**
 * 兜底校验后端返回的定弦。
 *
 * 正常情况后端只会存六种合法值（见 `VALID_TUNINGS`），但接口层不该信任网络数据：
 * 万一拿到未知字符串，退回正调也比让 `openMidi[index]` 取到 undefined 崩掉好。
 */
function normalizeTuning<T extends { tuning: TuningId }>(score: T): T {
  return isTuningId(score.tuning) ? score : { ...score, tuning: DEFAULT_TUNING };
}

/**
 * 保存曲谱。连后端时即「发布到社区共享池」。
 *
 * `author` 只在服务器模式生效：本机存储是私有草稿，署不署名没有意义，
 * 所以本地分支忽略该参数（`localCreateScore` 也不存它）。
 */
export async function createScore(
  title: string,
  notes: NoteColumn[],
  tuning: TuningId = DEFAULT_TUNING,
  author?: string,
): Promise<Score> {
  if (isBrowserOnlyMode()) return localCreateScore(title, notes, tuning);
  const name = author?.trim();
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    // 空署名不传字段：让后端落默认匿名，而不是存一个空字符串以外的脏值
    body: JSON.stringify({ title, notes, tuning, ...(name ? { author: name } : {}) }),
  });
  return normalizeTuning(await handleResponse<Score>(res));
}

/** 社区列表的一页。 */
export interface ScorePage {
  items: ScoreListItem[];
  /** 库里总共有多少首（服务端 `x-total-count`）。服务端没给时为 null。 */
  total: number | null;
}

/** 服务端单页硬上限，与 `routes.rs::MAX_PAGE_SIZE` 保持一致。 */
const MAX_PAGE_SIZE = 200;

/**
 * 取社区曲谱的一页。
 *
 * 纯前端模式下本地存储没有分页概念，整份返回，语义与服务器分支保持一致。
 */
export async function listScoresPage(
  options: {
    limit?: number;
    offset?: number;
    sort?: "recent" | "popular";
    /** 关键词：同时匹配曲名与署名（服务端 ILIKE，大小写不敏感）。 */
    query?: string;
    /** 定弦过滤：只留该定弦的谱。 */
    tuning?: TuningId;
  } = {},
): Promise<ScorePage> {
  if (isBrowserOnlyMode()) {
    let items = await localListScores();
    // 纯前端模式无后端：在本地做同样的「关键词 + 定弦」过滤，与服务端语义一致。
    // 注意：本地存储不记署名（StoredScore 无 author 字段），关键词只匹配曲名——
    // 这是本地库的固有局限，服务端仍按「曲名 + 署名」双匹配。
    const kw = options.query?.trim().toLowerCase();
    if (kw) {
      items = items.filter((s) => s.title.toLowerCase().includes(kw));
    }
    if (options.tuning && isTuningId(options.tuning)) {
      items = items.filter((s) => s.tuning === options.tuning);
    }
    // 纯前端模式无后端、本地存储不追踪收藏数，热度排序退化为按更新时间。
    const sorted =
      options.sort === "popular"
        ? [...items].sort(
            (a, b) =>
              (b.favorites_count ?? 0) - (a.favorites_count ?? 0) ||
              b.updated_at.localeCompare(a.updated_at),
          )
        : items;
    return { items: sorted.map(normalizeTuning), total: items.length };
  }
  const limit = options.limit ?? MAX_PAGE_SIZE;
  const offset = options.offset ?? 0;
  const sort = options.sort === "popular" ? "popular" : undefined;
  // 关键词 / 定弦走服务端过滤：拼进 URL 的是参数名与经过编码的值，
  // 值由 URLSearchParams 负责编码，不存在拼接 SQL 的风险。
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (sort) params.set("sort", sort);
  if (options.query?.trim()) params.set("q", options.query.trim());
  if (options.tuning && isTuningId(options.tuning)) params.set("tuning", options.tuning);
  const url = `${resolveBase()}/api/v1/scores?${params.toString()}`;
  const res = await fetchWithTimeout(url);
  const items = await handleResponse<ScoreListItem[]>(res);
  // 注意先判 null 再转数字：`Number(null)` 是 0，会把「服务端没给总数」
  // 误当成「库里有 0 首」，界面上就会出现「0 / 50」这种自相矛盾的提示。
  const rawTotal = res.headers.get("x-total-count");
  const parsed = rawTotal === null ? null : Number(rawTotal);
  return {
    items: items.map(normalizeTuning),
    total: parsed !== null && Number.isFinite(parsed) ? parsed : null,
  };
}

/**
 * 取**全部**社区曲谱（按页循环取完）。
 *
 * 保留这个全量接口是因为有些场景不能只看第一页：
 * 迁移本机曲谱时要用「已有曲名集合」去重，少看一条就会重复发布一首；
 * 判断「我发过没有」同理。这类判断错一次就是脏数据，不能为了省一次请求而漏。
 */
export async function listScores(): Promise<ScoreListItem[]> {
  const all: ScoreListItem[] = [];
  // 页数上限是死循环保险：万一服务端 total 不降（翻页参数失效），不能一直转下去
  for (let page = 0; page < 50; page += 1) {
    const { items, total } = await listScoresPage({
      limit: MAX_PAGE_SIZE,
      offset: all.length,
    });
    all.push(...items);
    if (items.length === 0) break;
    // 服务端没给总数 = 它还是分页之前的版本，一次就把全量返回了。
    // 这时候继续翻只会拿到同一批数据（offset 被老服务端忽略），
    // 结果是列表里每条谱重复 N 次。必须在这里停。
    if (total === null) break;
    if (all.length >= total) break;
  }
  return all;
}

export async function getScore(id: string): Promise<Score> {
  if (isBrowserOnlyMode()) return localGetScore(id);
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores/${id}`);
  return normalizeTuning(await handleResponse<Score>(res));
}

export async function updateScore(
  id: string,
  data: { title?: string; notes?: NoteColumn[]; tuning?: TuningId; author?: string },
): Promise<Score> {
  if (isBrowserOnlyMode()) return localUpdateScore(id, data);
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: JSON.stringify(data),
  });
  return normalizeTuning(await handleResponse<Score>(res));
}

export async function deleteScore(id: string): Promise<void> {
  if (isBrowserOnlyMode()) {
    localDeleteScore(id);
    return;
  }
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores/${id}`, {
    method: "DELETE",
    headers: ownerHeaders(),
  });
  await handleResponse(res);
}

/* ────────────────────────── 收藏夹 ────────────────────────── */

/**
 * 收藏一首谱（幂等）。
 *
 * 收藏跟着账号走，所以**必须登录**：本机凭证是「这台设备的钥匙」，
 * 清个缓存收藏就全丢，那就不叫收藏了。没登录时服务端回 401，
 * 界面应当先提示去登录，而不是静默失败。
 */
export async function favoriteScore(id: string): Promise<void> {
  ensureBackend();
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores/${id}/favorite`, {
    method: "PUT",
    headers: ownerHeaders(),
  });
  await handleResponse(res);
}

/** 取消收藏（幂等：没收藏过也返回成功）。 */
export async function unfavoriteScore(id: string): Promise<void> {
  ensureBackend();
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores/${id}/favorite`, {
    method: "DELETE",
    headers: ownerHeaders(),
  });
  await handleResponse(res);
}

/**
 * 当前账号收藏的全部曲谱 id。
 *
 * 列表每行都要画星标，逐行问会变成 N 次请求；一次取回 id 集合在本地比对即可。
 */
export async function listFavoriteIds(): Promise<string[]> {
  ensureBackend();
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/favorites/ids`, {
    headers: ownerHeaders(),
  });
  const data = await handleResponse<{ ids: string[] }>(res);
  return Array.isArray(data.ids) ? data.ids : [];
}

/** 我的收藏的一页（按收藏时间倒序）。 */
export async function listFavoritesPage(
  options: { limit?: number; offset?: number } = {},
): Promise<ScorePage> {
  ensureBackend();
  const limit = options.limit ?? MAX_PAGE_SIZE;
  const offset = options.offset ?? 0;
  const res = await fetchWithTimeout(
    `${resolveBase()}/api/v1/favorites?limit=${limit}&offset=${offset}`,
    { headers: ownerHeaders() },
  );
  const items = await handleResponse<ScoreListItem[]>(res);
  // 与社区列表同样：先判 null 再转数字，`Number(null)` 是 0 会造出「0 / 50」
  const rawTotal = res.headers.get("x-total-count");
  const parsed = rawTotal === null ? null : Number(rawTotal);
  return {
    items: items.map(normalizeTuning),
    total: parsed !== null && Number.isFinite(parsed) ? parsed : null,
  };
}

/* ────────────────────────── 社区账号 ────────────────────────── */

/** 未配置后端时账号功能的提示（纯前端模式下根本发不出去，别静默失败）。 */
const ACCOUNT_NEEDS_BACKEND = "登录 / 注册需要社区后端，请先在上方填写后端地址。";

function ensureBackend(): void {
  if (isBrowserOnlyMode()) throw new ApiError(ACCOUNT_NEEDS_BACKEND, 0);
}

export interface AuthResult {
  user: SessionUser;
  token: string;
}

async function authRequest<T>(path: string, body: unknown, token?: string): Promise<T> {
  ensureBackend();
  const res = await fetchWithTimeout(`${resolveBase()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

/** 注册（注册即登录，省一步）。昵称可省略。 */
export async function registerAccount(
  email: string,
  password: string,
  displayName?: string,
): Promise<AuthResult> {
  const name = displayName?.trim();
  const result = await authRequest<AuthResult>("/api/v1/auth/register", {
    email,
    password,
    ...(name ? { display_name: name } : {}),
  });
  setStoredSession({ token: result.token, user: result.user });
  return result;
}

/**
 * 登录。
 *
 * 后端对「邮箱不存在」与「口令不对」返回同一句话（区分了等于帮人枚举账号），
 * 所以这里不额外做本地判别，直接把后端原话抛给界面。
 */
export async function loginAccount(email: string, password: string): Promise<AuthResult> {
  const result = await authRequest<AuthResult>("/api/v1/auth/login", { email, password });
  setStoredSession({ token: result.token, user: result.user });
  return result;
}

/**
 * 申请找回口令：把一次性重置链接寄到注册邮箱。
 *
 * 后端对「注册过 / 没注册过」返回一模一样的响应（防账号枚举），
 * 所以前端也不判别、更不能提示「该邮箱未注册」——提示了等于把枚举搬到界面上。
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await authRequest<{ ok: true }>("/api/v1/auth/forgot-password", { email });
}

/**
 * 凭邮件里的一次性令牌设新口令（令牌用过即废）。
 *
 * 成功后旧会话会被服务端全部吊销，所以这里**不**顺手写登录态——
 * 让用户用新口令走一次正常登录，语义最清楚。
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<void> {
  await authRequest<{ ok: true }>("/api/v1/auth/reset-password", {
    token,
    new_password: newPassword,
  });
}

/**
 * 登出：让服务端删掉会话行，再清本地。
 *
 * 即使请求失败也要清本地——「登出」这个动作本身不该依赖网络，
 * 否则后端一挂用户就困在已登录状态里出不来。
 */
export async function logoutAccount(): Promise<void> {
  const token = getSessionToken();
  try {
    if (token) await authRequest<{ ok: boolean }>("/api/v1/auth/logout", {}, token);
  } finally {
    clearStoredSession();
  }
}

/**
 * 查询当前登录者（校验会话是否还有效）。
 *
 * 会话过期 / 被吊销时后端返回 401，这里顺手清掉本地登录态——
 * 否则界面一直显示「已登录」，一点保存却 403，用户完全不知道发生了什么。
 */
export async function fetchCurrentUser(): Promise<SessionUser | null> {
  const token = getSessionToken();
  if (!token) return null;
  ensureBackend();
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    clearStoredSession();
    return null;
  }
  return handleResponse<SessionUser>(res);
}

/**
 * 认领旧谱：把「这台设备用凭证发布的谱」挂到账号下。
 *
 * 认领之后换设备、清缓存都不会再失去它——这是账号体系解决的核心问题。
 * 必须同时具备登录态与原凭证（请求头由 `ownerHeaders` 一并提供），
 * 缺一样服务端都会拒绝：否则任何人注册一下就能把别人的谱认领走。
 */
export async function claimScore(id: string): Promise<ScoreListItem> {
  ensureBackend();
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores/${id}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
  });
  return normalizeTuning(await handleResponse<ScoreListItem>(res));
}

export interface ReportResult {
  /** 这次是否真的记上了。`false` = 之前已经举报过同一首（服务端按人去重）。 */
  reported: boolean;
  /** 这首谱当前被多少**不同的人**举报过。 */
  reports_count: number;
}

/**
 * 举报一首谱。
 *
 * **必须登录**：本机凭证是设备钥匙，存进举报表等于把改删凭据多存一份；
 * 而账号 id 本身不是秘密，既能去重也能追责。
 *
 * 服务端只记录、**不会自动下架**——注册不需要邮箱验证，自动下架等于给攻击者
 * 一个「三个小号删任何谱」的开关。这里只负责把线索交上去。
 */
export async function reportScore(id: string): Promise<ReportResult> {
  ensureBackend();
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores/${id}/report`, {
    method: "POST",
    headers: ownerHeaders(),
  });
  return handleResponse<ReportResult>(res);
}

export interface CandidateSelection {
  note_index: number;
  candidate_index: number;
  reason: string;
}

export interface SelectCandidatesResponse {
  method: "llm" | "heuristic";
  selections: CandidateSelection[];
}

export async function selectCandidates(
  notes: { number: number; octave: number }[],
  tuning: string,
): Promise<SelectCandidatesResponse> {
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/translate/select`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ notes, tuning }),
  });
  return handleResponse(res);
}

export interface RecognizeJianziResponse {
  /** template=模板匹配；llm=视觉模型识别；unavailable=后端未启用 */
  method: "template" | "llm" | "unavailable";
  /** 模型给出的规范减字文本，如「散挑一」「大九勾四」；为空表示识别失败 */
  glyph: string | null;
  /** 识别依据（可解释性） */
  explanation: string | null;
  /** 0~1 置信度 */
  confidence: number | null;
}

/**
 * 减字谱单字图像识别：base64 图片 → Claude 多模态 → 规范减字文本。
 * 后端未配置 ANTHROPIC_API_KEY 时返回 method="unavailable" + 503。
 */
export async function recognizeJianzi(
  imageBase64: string,
  mediaType: string,
): Promise<RecognizeJianziResponse> {
  if (isBrowserOnlyMode()) throw new ApiError(BROWSER_ONLY_RECOGNIZE_HINT, 503);
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/jianzi/recognize`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ image_base64: imageBase64, media_type: mediaType }),
  });
  return handleResponse(res);
}

/** 整页识别中的单个字格。 */
export interface RecognizeSheetCell {
  /** 行号：从上到下，首行 = 0 */
  row: number;
  /** 列号：从左到右，最左列 = 0（减字谱实际阅读为同排从右到左，前端导入时换算） */
  col: number;
  /** 规范减字文本；看不清为 null */
  glyph: string | null;
  /** 识别依据（可解释性） */
  explanation: string | null;
  /** 0~1 置信度 */
  confidence: number | null;
}

export interface RecognizeSheetResponse {
  /** template=模板切分+逐格匹配（电子谱面确定性路径）；llm=视觉模型识别 */
  method: "template" | "llm" | "unavailable";
  /** 识别出的所有字格（坐标可能非连续，前端按 row/col 重排为网格） */
  cells: RecognizeSheetCell[];
}

/**
 * 整页减字谱图像识别：base64 图片 → 电子谱面走模板切分（method="template"，
 * 字高 ≥72px 时逐格 100%），其余落 Claude 多模态（method="llm"）。
 * LLM 未配置且模板无结果时 503。
 */
export async function recognizeJianziSheet(
  imageBase64: string,
  mediaType: string,
): Promise<RecognizeSheetResponse> {
  if (isBrowserOnlyMode()) throw new ApiError(BROWSER_ONLY_RECOGNIZE_HINT, 503);
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/jianzi/recognize-sheet`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ image_base64: imageBase64, media_type: mediaType }),
  });
  return handleResponse(res);
}
