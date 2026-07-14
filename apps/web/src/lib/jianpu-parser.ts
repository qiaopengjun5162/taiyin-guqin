/**
 * 简谱字符串解析器。
 *
 * 支持格式：
 * - 数字 1-7 表示基本音级
 * - 数字后紧跟 `·` 或 `'` 表示高八度
 * - 数字后紧跟 `,` 表示低八度
 * - 空格或 `|` 作为小节/音符分隔符
 * - `-` 或 `0` 表示延音/休止占位
 *
 * 示例：
 * - `"5 6 1 2 | 3 5 6 -"`
 * - `"5· 3, | 1 2 3"`
 */

export interface ParsedJianpuNote {
  /** 简谱数字 1-7。 */
  number: number;
  /** 八度偏移：0 = 中央组，+1 = 高八度，-1 = 低八度。 */
  octave: number;
  /** 原始字符串片段，用于 UI 回显。 */
  raw: string;
}

/**
 * 解析简谱字符串为音符序列。
 *
 * 返回数组中每个元素对应一个「位置」：
 * - `ParsedJianpuNote` 表示有效音符
 * - `null` 表示延音或休止占位
 */
export function parseJianpuString(input: string): (ParsedJianpuNote | null)[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const tokens = tokenize(trimmed);
  return tokens.map(parseToken).filter((n): n is ParsedJianpuNote | null => n !== undefined);
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";

  for (const char of input) {
    if (char === " " || char === "\t" || char === "|") {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function parseToken(token: string): ParsedJianpuNote | null | undefined {
  if (token === "-" || token === "0") {
    return null;
  }

  const match = token.match(/^(\d)([·',]?)$/);
  if (!match) return undefined;

  const number = parseInt(match[1], 10);
  if (number < 1 || number > 7) return undefined;

  const octaveMarker = match[2];
  const octave = octaveMarker === "·" || octaveMarker === "'" ? 1 : octaveMarker === "," ? -1 : 0;

  return {
    number,
    octave,
    raw: token,
  };
}
