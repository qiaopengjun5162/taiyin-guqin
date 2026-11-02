/**
 * 麦克风录音：把一次练习录下来。
 *
 * 只做一件事——拿到一段可回放的 Blob 和它真实的时长。上传、转码、波形分析
 * 都不在这里；本站是静态站点，音频不离开本机。
 *
 * 三个必须说清的点：
 *  1. 关掉降噪 / 自动增益 / 回声消除。这三项是为语音通话设计的：降噪把古琴
 *     衰减的尾音当噪声吃掉，自动增益让弱音变响、散音与按音动态全平。
 *  2. 时长自己记（wall clock，排除暂停）。WebM/Opus 的 `audio.duration` 是
 *     Infinity，靠媒体元素量时长会得到 NaN。
 *  3. mime 按浏览器能力挑：Chrome/Firefox 给 webm+opus，Safari 只认 mp4。
 *     挑错不是音质问题，是「录完打不开」。
 */

export interface RecordingResult {
  blob: Blob;
  seconds: number;
  mime: string;
}

export interface RecordingSession {
  readonly paused: boolean;
  /** 已录时长（秒，不含暂停段）。 */
  elapsedSeconds(): number;
  pause(): void;
  resume(): void;
  /** 收尾并拿到录音。可重复调用，返回同一个 Promise。 */
  stop(): Promise<RecordingResult>;
  /** 放弃这段录音（释放麦克风，不产出 Blob）。 */
  cancel(): void;
}

export interface StartRecordingOptions {
  /** 实时音量（0–1 的粗刻度），用来画电平条。 */
  onLevel?: (level: number) => void;
}

/** 从好到差的候选。opus 在同等体积下最适合录乐器。 */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** 按浏览器实际支持的能力挑第一个可用的，全不支持时返回空串（交给浏览器默认）。 */
export function pickMimeType(supported: (type: string) => boolean): string {
  for (const type of MIME_CANDIDATES) {
    if (supported(type)) return type;
  }
  return "";
}

export function isRecordingSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const Ctor = (window as Window & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  return typeof Ctor !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/** 把 DOMException 翻成人话（各浏览器 name 一致，message 不一致）。 */
export function micErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError") {
    return "麦克风权限被拒绝。请在浏览器地址栏的权限里允许本站使用麦克风后重试。";
  }
  if (name === "NotFoundError") return "没有找到麦克风设备。";
  if (name === "NotReadableError") return "麦克风被其他程序占用了，关掉再试。";
  return "打不开麦克风，请检查系统权限或换个浏览器。";
}

const UNSUPPORTED = "这个浏览器不支持录音，或页面不在 https / localhost 下。可以先用缓存音色播放，或用「跟录音练」导入已有音频。";

export async function startRecording(
  options: StartRecordingOptions = {},
): Promise<RecordingSession> {
  if (!isRecordingSupported()) throw new Error(UNSUPPORTED);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (error) {
    throw new Error(micErrorMessage(error));
  }

  const Ctor = (window as Window & { MediaRecorder: typeof MediaRecorder }).MediaRecorder;
  const mimeType = pickMimeType((type) => {
    const probe = (Ctor as unknown as { isTypeSupported?: (t: string) => boolean }).isTypeSupported;
    return typeof probe === "function" ? probe(type) : true;
  });

  let recorder: MediaRecorder;
  try {
    recorder = mimeType ? new Ctor(stream, { mimeType }) : new Ctor(stream);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("这个浏览器拒绝了录音格式，换个浏览器再试。");
  }

  const chunks: BlobPart[] = [];
  let paused = false;
  let stopped = false;
  let cancelled = false;
  let elapsedMs = 0;
  let resumedAt = now();

  function now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  /** 把「本段连续计时」结算进总额；暂停/收尾都先调它。 */
  function accumulate(): void {
    if (paused || stopped) return;
    elapsedMs += now() - resumedAt;
  }

  // ── 电平条：只做视觉反馈，失败不影响录音 ──
  let audioCtx: AudioContext | null = null;
  let rafId: number | null = null;
  const stopMeter = () => {
    if (rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
    }
    rafId = null;
    void audioCtx?.close().catch(() => {});
    audioCtx = null;
  };

  if (options.onLevel && typeof window !== "undefined") {
    try {
      const CtorCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (CtorCtx) {
        audioCtx = new CtorCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const onLevel = options.onLevel;
        const loop = () => {
          if (!audioCtx) return;
          analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
          let sum = 0;
          for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
          // ×6 只是让拨弦在电平条上明显跳一下，不是声压级
          onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      }
    } catch {
      // AudioContext 不可用（老浏览器 / 无音频输出设备）就只录音，不画电平
      audioCtx = null;
    }
  }

  const release = () => {
    stopMeter();
    stream.getTracks().forEach((t) => t.stop());
  };

  let deferred:
    | { promise: Promise<RecordingResult>; resolve: (r: RecordingResult) => void; reject: (e: Error) => void }
    | null = null;

  function ensureDeferred() {
    if (!deferred) {
      let resolve!: (r: RecordingResult) => void;
      let reject!: (e: Error) => void;
      const promise = new Promise<RecordingResult>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      deferred = { promise, resolve, reject };
    }
    return deferred;
  }

  function finish(): void {
    const d = ensureDeferred();
    const type = recorder.mimeType || mimeType || "audio/webm";
    d.resolve({
      blob: new Blob(chunks, { type }),
      seconds: Math.round(elapsedMs) / 1000,
      mime: type,
    });
  }

  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onerror = () => {
    stopped = true;
    release();
    ensureDeferred().reject(new Error("录音中断了，请重试。"));
  };
  recorder.onstop = () => {
    release();
    if (cancelled) {
      ensureDeferred().reject(new Error("录音已取消"));
      return;
    }
    finish();
  };

  recorder.start(1000); // 每秒切一块：中途停止也不至于丢掉最后一段

  return {
    get paused() {
      return paused;
    },
    elapsedSeconds() {
      const running = paused || stopped ? 0 : now() - resumedAt;
      return (elapsedMs + running) / 1000;
    },
    pause() {
      if (paused || stopped) return;
      accumulate();
      paused = true;
      if (recorder.state === "recording") recorder.pause();
      if (rafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
    resume() {
      if (!paused || stopped) return;
      paused = false;
      resumedAt = now();
      if (recorder.state === "paused") recorder.resume();
    },
    stop() {
      const d = ensureDeferred();
      if (stopped) return d.promise;
      accumulate();
      stopped = true;
      try {
        if (recorder.state === "inactive") {
          release();
          finish();
        } else {
          recorder.stop();
        }
      } catch {
        release();
        finish();
      }
      return d.promise;
    },
    cancel() {
      if (stopped) return;
      cancelled = true;
      stopped = true;
      // 先挂一个空 catch：没人 await 这次取消时，不该冒出一条 unhandled rejection
      void ensureDeferred().promise.catch(() => {});
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // 已经停了就算了
      }
      release();
    },
  };
}
