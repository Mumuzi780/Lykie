/** Lykie 打字速度：每字 400ms（标点/空白不计）。
 * 纯符号消息、系统提示默认 500ms。思考用 wait 节点。
 */
export const TYPING_MS_PER_CHAR = 400
export const MIN_MESSAGE_DELAY_MS = 500

/** 计时字数：去掉空白与标点（含中英文标点、省略号等）。 */
export function typingCharCount(text: string): number {
  return [...String(text || '')].filter((ch) => !/[\s\p{P}]/u.test(ch)).length
}

/** Lykie「出现前延迟」：有计时字则 字数×400ms；纯符号/空文案 → 500ms。 */
export function typingDelayMs(text: string): number {
  const n = typingCharCount(text)
  if (n <= 0) return MIN_MESSAGE_DELAY_MS
  return Math.round(n * TYPING_MS_PER_CHAR)
}

/** 系统提示默认延迟。 */
export function systemDefaultDelayMs(): number {
  return MIN_MESSAGE_DELAY_MS
}

export function typingDelayHint(text: string): string {
  const n = typingCharCount(text)
  const ms = typingDelayMs(text)
  const raw = [...String(text || '').trim()].length
  const skipped = Math.max(0, raw - n)
  if (n <= 0) {
    return `纯符号/空 → ${(ms / 1000).toFixed(1)}s`
  }
  const skipNote = skipped > 0 ? `，已不计标点/空白 ${skipped}` : ''
  return `计时 ${n} 字 ≈ ${(ms / 1000).toFixed(1)}s（${TYPING_MS_PER_CHAR}ms/字${skipNote}）`
}
