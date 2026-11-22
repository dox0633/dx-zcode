/**
 * 调用记录：按账号归属，不含对话内容。
 *
 * 环形缓冲，最多 200 条 / 24 小时，避免长期运行后占用内存。
 */

/** 单条记录上限 24 小时。 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** 环形缓冲容量。 */
const MAX_ENTRIES = 200

/**
 * 从 turn.completed 的 usage 提取 token 计数及缓存命中指标。上游形状不对外承诺，防御式读取。
 * @param {any} usage
 * @returns {{ input: number, output: number, cached: number, cacheRate: number, total: number } | null}
 */
export function tokensOf(usage) {
  if (usage === null || typeof usage !== 'object') return null
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const cached = n(usage.cacheReadTokens ?? usage.cache_read_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cachedTokens ?? usage.cache_tokens ?? usage.cacheRead)
  const output = n(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? usage.output ?? usage.output_units ?? usage.outputUnits)
  
  // 优先取已明确区分的 inputTokens
  let input = n(usage.inputTokens ?? usage.uncachedInputTokens ?? usage.input_units ?? usage.inputUnits)
  const rawInput = n(usage.input_tokens ?? usage.prompt_tokens ?? usage.input)
  if (input === 0 && rawInput > 0) {
    input = cached > 0 && rawInput >= cached ? rawInput - cached : rawInput
  }
  if (input === 0 && output === 0 && cached === 0) return null

  const promptTotal = input + cached
  const cacheRate = promptTotal > 0 ? Math.round((cached / promptTotal) * 100) : 0
  const total = n(usage.totalTokens ?? usage.total_tokens ?? usage.total_units ?? (promptTotal + output))

  return {
    input,
    output,
    cached,
    cacheRate,
    total: total > 0 ? total : promptTotal + output,
  }
}

export class CallLog {
  constructor() {
    /** @type {any[]} */
    this.entries = []
  }

  /**
   * @param {{
   *   account: string,
   *   accountId: string,
   *   model: string,
   *   kind: 'gateway'|'provider',
   *   ok: boolean,
   *   durationMs: number,
   *   tps?: number,
   *   error?: string,
   *   tokens?: { input: number, output: number, cached: number, cacheRate: number, total: number } | null
   * }} entry
   * @returns {void}
   */
  push(entry) {
    const durationMs = Math.round(entry.durationMs)
    const tokens = entry.tokens ?? undefined
    let tps = entry.tps
    if (tps === undefined && tokens && tokens.output > 0 && durationMs > 0) {
      tps = +(tokens.output / (durationMs / 1000)).toFixed(1)
    }

    const rawChannel = entry.channel ?? entry.route?.channel ?? (entry.kind === 'gateway' ? 'gateway' : 'cli')
    const channel = String(rawChannel).toLowerCase().includes('direct') ? 'direct' : (String(rawChannel).toLowerCase().includes('gateway') ? 'gateway' : 'cli')

    this.entries.push({
      at: Date.now(),
      account: entry.account,
      accountId: entry.accountId,
      model: entry.model,
      kind: entry.kind,
      channel,
      ok: entry.ok,
      durationMs,
      tps,
      tokens,
      error: entry.error === undefined ? undefined : String(entry.error).slice(0, 200),
    })
    this.trim()
  }

  /** @returns {void} */
  trim() {
    const cutoff = Date.now() - MAX_AGE_MS
    this.entries = this.entries.filter((e) => e.at >= cutoff)
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES)
  }

  /**
   * 最新在前。
   * @param {number} [limit]
   * @returns {any[]}
   */
  view(limit = 50) {
    this.trim()
    return this.entries.slice(-limit).reverse()
  }

  /** @returns {void} */
  clear() {
    this.entries = []
  }

  /** @returns {void} */
  clearFailed() {
    this.entries = this.entries.filter((e) => e.ok)
  }

  /**
   * 按账号聚合的统计。
   * @returns {Array<{ accountId: string, account: string, total: number, failed: number, avgMs: number, avgTps: number, cacheRate: number }>}
   */
  stats() {
    this.trim()
    /** @type {Map<string, { account: string, total: number, failed: number, sumMs: number, sumTps: number, tpsCount: number, sumInput: number, sumCached: number }>} */
    const map = new Map()
    for (const e of this.entries) {
      const key = String(e.accountId ?? '')
      const cur = map.get(key) ?? {
        account: String(e.account ?? '—'),
        total: 0,
        failed: 0,
        sumMs: 0,
        sumTps: 0,
        tpsCount: 0,
        sumInput: 0,
        sumCached: 0,
      }
      cur.total++
      cur.sumMs += Number(e.durationMs) || 0
      if (!e.ok) cur.failed++
      if (typeof e.tps === 'number' && e.tps > 0) {
        cur.sumTps += e.tps
        cur.tpsCount++
      }
      if (e.tokens) {
        cur.sumInput += Number(e.tokens.input) || 0
        cur.sumCached += Number(e.tokens.cached) || 0
      }
      map.set(key, cur)
    }
    return [...map.entries()].map(([accountId, v]) => {
      const promptTotal = v.sumInput + v.sumCached
      return {
        accountId,
        account: v.account,
        total: v.total,
        failed: v.failed,
        avgMs: v.total === 0 ? 0 : Math.round(v.sumMs / v.total),
        avgTps: v.tpsCount === 0 ? 0 : +(v.sumTps / v.tpsCount).toFixed(1),
        cacheRate: promptTotal === 0 ? 0 : +((v.sumCached / promptTotal) * 100).toFixed(1),
      }
    })
  }
}
