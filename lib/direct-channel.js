/**
 * 直连通道（v0.3.0）：自建 HTTP 直打 zcode-plan anthropic 端点，无 CLI 依赖。
 *
 * 依据（2026-11-21 本机实测 + dsh-xdpool#187 + B3hnamR/AutoZCoder）：
 * 2026-11-17 起 zcode.z.ai 的模型端点门禁改为「客户端信封逐字节校验」：
 *   - system 恒三块：CLI 前缀 / identity+security+harness / output-style（2、3 块带 cache_control）
 *   - 七项请求头：UA 带 ai-sdk 后缀、X-Release-Channel=production、X-Client-Language=en-US、
 *     X-Client-Timezone=UTC、X-Platform=win32-x64、X-Os-Version、X-Session-Id/X-Title/X-ZCode-Agent
 * 实测：三块信封 + 七项头 → HTTP 200 真实模型响应（input 272 / output 16）。
 * 信封原文运行时从本地官方客户端 bundle（zcode.cjs）提取，提取失败回退到内嵌基线
 * （2026-11-21 逐字节验证过的版本）；官方客户端升级导致漂移时，3012 会明确报错，
 * 由操作者手动切回 CLI 通道（本设计不做跨通道自动回退——「选择哪个就用哪个」）。
 *
 * 输出统一映射为 DSH StreamChunk：text-delta / reasoning-delta / tool-call-delta /
 * usage / finish——工具由 DSH 自己的 harness 执行（原生工具卡片）。
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { locateCli } from './credentials.js'

/** 单轮直连请求的 SSE 空闲看门狗：超过该时长无任何数据即中止。 */
const IDLE_TIMEOUT_MS = 120000

// ── 官方信封基线（从官方 ZCode 客户端资源逐字节提取，
//    并经线上门禁实测通过；运行时会尝试从本地 bundle 重新提取以跟随客户端漂移）──────
const BASELINE = {
  cliPrefix: 'You are ZCode, an interactive agent',
  identity: 'You are an agent working with the user toward their goals, using your own judgment along the way.',
  security: 'IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.',
  harness: [
    '# Harness',
    ' - Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.',
    " - Tools run behind a user-selected permission mode; a denied call means the user declined it \u2014 adjust, don't retry verbatim.",
    ' - `<system-reminder>` tags in messages and tool results are injected by the harness, not the user. Hooks may intercept tool calls; treat hook output as user feedback.',
    ' - Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.',
    " - Reference code as `file_path:line_number` \u2014 it's clickable.",
  ].join('\n'),
  outputStyle: '\n\nWrite code that reads like the surrounding code: match its comment density, naming, and idiom.',
  appVersion: '3.18.2',
}

/** 信封缓存（进程级）。@type {{ envelope: { cliPrefix: string, identityBlock: string, outputStyle: string }, appVersion: string, source: string } | null} */
let envelopeCache = null

/**
 * 从本地官方客户端 bundle 提取信封原文（跟随客户端升级；失败回退内嵌基线）。
 * @param {string} [bundlePath] 官方 zcode.cjs 路径；缺省探测标准安装位。
 * @returns {{ cliPrefix: string, identityBlock: string, outputStyle: string, appVersion: string, source: string }}
 */
export function buildEnvelope(bundlePath) {
  if (envelopeCache !== null) return envelopeCache
  let env = { ...BASELINE, identityBlock: buildIdentityBlock(BASELINE), source: 'embedded-baseline' }
  try {
    const candidates = [
      bundlePath,
      'C:\\Program Files\\ZCode\\resources\\glm\\zcode.cjs',
      'C:\\Program Files (x86)\\ZCode\\resources\\glm\\zcode.cjs',
    ].filter((v) => typeof v === 'string' && v !== '')
    // 兜底：npm 版官方 CLI 也是同一套官方构建（信封常量一致）
    try { candidates.push(locateCli('').path) } catch { /* 无 CLI 则跳过 */ }
    for (const file of candidates) {
      let src = ''
      try {
        if (!fs.statSync(file).isFile()) continue
        src = fs.readFileSync(file, 'utf8')
      } catch { continue }
      const prefix = matchQuoted(src, 'You are ZCode, an interactive agent')
      const identity = matchQuoted(src, 'You are an agent working with the user toward their goals, using your own judgment along the way.')
      const security = matchQuoted(src, 'IMPORTANT: Assist with authorized security testing')
      const outputStyle = matchQuoted(src, 'Write code that reads like the surrounding code')
      if (!prefix || !identity || !security || !outputStyle) continue
      env = {
        cliPrefix: prefix,
        identityBlock: buildIdentityBlock({ identity, security, harness: extractHarness(src) ?? BASELINE.harness }),
        outputStyle: '\n\n' + outputStyle,
        source: file,
      }
      break
    }
  } catch {
    /* 提取失败保持基线。 */
  }
  envelopeCache = env
  return env
}

/** @param {string} src @param {string} anchor @returns {string | null} 提取包含 anchor 的完整双引号字符串 */
function matchQuoted(src, anchor) {
  const i = src.indexOf(anchor)
  if (i < 0) return null
  // 向前找最近的开引号，向后找最近的闭引号
  let start = -1
  for (let k = i; k >= Math.max(0, i - 400); k--) {
    if (src[k] === '"' && src[k - 1] !== '\\') { start = k; break }
  }
  if (start < 0) return null
  let end = -1
  for (let k = start + 1; k < Math.min(src.length, i + anchor.length + 4000); k++) {
    if (src[k] === '"' && src[k - 1] !== '\\') { end = k; break }
  }
  if (end < 0) return null
  try {
    return JSON.parse(src.slice(start, end + 1))
  } catch {
    return null
  }
}

/** 提取官方 harness 块数组（v3n 的字面量，取 system-reminder 分支无法静态求值，回退基线）。 */
function extractHarness(src) {
  // 官方 bundle 为压缩产物，harness 数组含条件模板，稳妥起见使用基线（实测通过版本）。
  void src
  return null
}

/**
 * identity 块（= 官方 Vrc(false,false)：\n + 身份 + \n\n + 安全声明 + \n\n + harness）。
 * @param {{ identity: string, security: string, harness: string }} parts
 * @returns {string}
 */
function buildIdentityBlock(parts) {
  return ['\n', parts.identity, '\n\n', parts.security, '\n\n', parts.harness].join('')
}

/**
 * 组装七项对齐的直连请求头。
 * @param {{ planToken: string, deviceMid: string }} account
 * @param {string} [appVersion]
 * @returns {Record<string, string>}
 */
export function buildDirectHeaders(account, appVersion) {
  const env = buildEnvelope()
  const version = appVersion || env.appVersion || BASELINE.appVersion
  return {
    accept: '*/*',
    'content-type': 'application/json',
    authorization: `Bearer ${account.planToken}`,
    'user-agent': `ZCode/${version} ai-sdk/provider-utils/4.0.27 runtime/node.js/24`,
    'X-ZCode-App-Version': version,
    'X-Release-Channel': 'production',
    'X-Client-Language': 'en-US',
    'X-Client-Timezone': 'UTC',
    'X-Platform': 'win32-x64',
    'X-Os-Version': '10.0.26200',
    'X-Device-Mid': account.deviceMid,
    'X-Session-Id': randomUUID(),
    'X-Title': 'Z Code@cli',
    'X-ZCode-Agent': 'glm',
  }
}

/**
 * 三块 system 信封；调用方 system 文本折进第三块（官方恒三块，第 4 块即 3012）。
 * @param {string} [callerSystem]
 * @returns {Array<{ type: 'text', text: string, cache_control?: { type: 'ephemeral' } }>}
 */
export function buildSystemBlocks(callerSystem) {
  const env = buildEnvelope()
  const third = env.outputStyle + (callerSystem && callerSystem.trim() !== '' ? '\n\n' + callerSystem : '')
  return [
    { type: 'text', text: env.cliPrefix },
    { type: 'text', text: env.identityBlock, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: third, cache_control: { type: 'ephemeral' } },
  ]
}

/**
 * DSH ToolSchema[] → anthropic tools 字段。
 * @param {readonly any[]} [tools]
 * @returns {Array<{ name: string, description: string, input_schema: Record<string, unknown> }> | undefined}
 */
export function mapTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined
  return tools.map((t) => ({
    name: String(t?.name ?? ''),
    description: String(t?.description ?? ''),
    input_schema: (t?.parameters && typeof t.parameters === 'object') ? t.parameters : { type: 'object', properties: {} },
  })).filter((t) => t.name !== '')
}

/**
 * DSH RequestMessage[] → anthropic messages。
 * 映射：user/assistant 文本、assistant tool-call → tool_use、tool 角色 → tool_result
 * （连续 tool 消息合并为一个 user 轮）；developer/system 角色跳过（system 走信封第三块，
 * tools 走顶层字段）；reasoning/file/image 块当前不回放。
 * @param {readonly any[]} messages
 * @returns {Array<{ role: 'user' | 'assistant', content: any }>}
 */
export function mapMessages(messages) {
  /** @type {Array<{ role: 'user' | 'assistant', content: any }>} */
  const out = []
  /** @type {Array<any>} 连续 tool 结果缓冲 */
  let toolBuffer = []

  const pushMessage = (role, blocks) => {
    if (!Array.isArray(blocks) || blocks.length === 0) return
    if (out.length > 0 && out[out.length - 1].role === role) {
      const prev = out[out.length - 1]
      prev.content = (Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: String(prev.content) }]).concat(blocks)
    } else {
      out.push({ role, content: blocks })
    }
  }

  const flushTools = () => {
    if (toolBuffer.length === 0) return
    pushMessage('user', toolBuffer)
    toolBuffer = []
  }
  const textBlocksOf = (content) => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .map((p) => (p?.type === 'text' && typeof p.text === 'string' ? p.text : ''))
      .filter((s) => s !== '')
      .join('\n')
  }
  for (const msg of messages ?? []) {
    const role = String(msg?.role ?? '')
    if (role === 'system' || role === 'developer') continue
    if (role === 'tool') {
      const parts = []
      if (Array.isArray(msg.content)) {
        for (const p of msg.content) {
          if (p?.type === 'text' && typeof p.text === 'string' && p.text !== '') parts.push(p.text)
        }
      } else if (typeof msg.content === 'string' && msg.content !== '') {
        parts.push(msg.content)
      }
      toolBuffer.push({
        type: 'tool_result',
        tool_use_id: String(msg.toolCallId ?? ''),
        content: parts.join('\n') || '(空结果)',
        is_error: msg.isError === true,
      })
      continue
    }
    flushTools()
    if (role === 'user') {
      const text = textBlocksOf(msg.content)
      if (text !== '') pushMessage('user', [{ type: 'text', text }])
      continue
    }
    if (role === 'assistant') {
      /** @type {any[]} */
      const content = []
      if (typeof msg.content === 'string') {
        if (msg.content !== '') content.push({ type: 'text', text: msg.content })
      } else if (Array.isArray(msg.content)) {
        for (const p of msg.content) {
          if (p?.type === 'text' && typeof p.text === 'string' && p.text !== '') content.push({ type: 'text', text: p.text })
          if (p?.type === 'tool-call') {
            let input = {}
            try { input = JSON.parse(p.arguments || '{}') } catch { input = {} }
            content.push({ type: 'tool_use', id: String(p.id ?? ''), name: String(p.name ?? ''), input })
          }
          // reasoning 块不回放（上游 thinking 块需要 signature，DSH 侧未持久化）
        }
      }
      if (content.length > 0) pushMessage('assistant', content)
      continue
    }
    // 未知角色跳过
  }
  flushTools()
  return out
}

/**
 * 直连一轮：SSE 流式请求 anthropic 端点，产出 DSH StreamChunk。
 * 抛错带 code：GATE_3012（信封漂移）/ DIRECT_HTTP（其他上游/网络错误）/ DIRECT_IDLE（空闲超时）。
 * @param {{
 *   planToken: string, deviceMid: string, modelId: string,
 *   system?: string, tools?: readonly any[], messages: readonly any[],
 *   maxTokens?: number, temperature?: number, stop?: string[],
 *   signal?: AbortSignal, idleTimeoutMs?: number,
 * }} input
 * @returns {AsyncGenerator<any, void, unknown>}
 */
export async function* streamDirectCall(input) {
  const env = buildEnvelope()
  const headers = buildDirectHeaders({ planToken: input.planToken, deviceMid: input.deviceMid })
  const body = JSON.stringify({
    model: input.modelId,
    max_tokens: input.maxTokens ?? 32768,
    stream: true,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(Array.isArray(input.stop) && input.stop.length > 0 ? { stop_sequences: input.stop } : {}),
    system: buildSystemBlocks(input.system),
    ...(mapTools(input.tools) ? { tools: mapTools(input.tools) } : {}),
    messages: mapMessages(input.messages),
  })

  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onOuterAbort, { once: true })
  let idleTimer = null
  const armIdle = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(new Error('idle')), input.idleTimeoutMs ?? IDLE_TIMEOUT_MS)
    idleTimer.unref?.()
  }

  let response
  try {
    armIdle()
    response = await fetch('https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages', {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      const isGate = response.status === 405 || /3012/.test(text)
      const e = /** @type {Error & { code: string }} */ (new Error(
        isGate
          ? '直连被门禁拒绝（3012）：官方客户端信封可能已漂移，请在面板切换回 CLI 通道'
          : `直连上游错误：HTTP ${response.status} ${text.slice(0, 200)}`,
      ))
      e.code = isGate ? 'GATE_3012' : 'DIRECT_HTTP'
      e.status = response.status
      throw e
    }
  } catch (error) {
    clearTimeout(idleTimer)
    input.signal?.removeEventListener('abort', onOuterAbort)
    if (error?.code === 'GATE_3012' || error?.code === 'DIRECT_HTTP') throw error
    const e = /** @type {Error & { code: string }} */ (new Error(
      error?.message === 'idle' ? '直连通道空闲超时（无数据超过 120s）' : `直连请求失败：${error instanceof Error ? error.message : String(error)}`,
    ))
    e.code = error?.message === 'idle' ? 'DIRECT_IDLE' : 'DIRECT_HTTP'
    throw e
  }

  // SSE 解析
  const decoder = new TextDecoder()
  let buffer = ''
  /** @type {Map<number, { type: string, id?: string, name?: string }>} */
  const openBlocks = new Map()
  /** @type {any} */
  let usage = null
  let stopReason = null
  let reader = null
  /** @type {Array<() => void>} */
  const cleanups = []
  cleanups.push(() => { clearTimeout(idleTimer) })
  cleanups.push(() => input.signal?.removeEventListener('abort', onOuterAbort))

  try {
    reader = response.body.getReader()
    let sawFirstData = false
    /** @param {string} eventName @param {any} data @returns {boolean} 是否产生了输出 */
    const handleEvent = (eventName, data) => {
      if (eventName === 'error' || data?.type === 'error') {
        const msg = data?.error?.message ?? JSON.stringify(data).slice(0, 200)
        const e = /** @type {Error & { code: string }} */ (new Error(`直连上游流错误：${msg}`))
        e.code = 'DIRECT_HTTP'
        throw e
      }
      if (eventName === 'message_start') {
        const u = data?.message?.usage
        if (u) usage = { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cache_read_input_tokens: u.cache_read_input_tokens ?? 0 }
        return false
      }
      if (eventName === 'content_block_start') {
        const index = Number(data?.index ?? 0)
        const block = data?.content_block ?? {}
        openBlocks.set(index, { type: String(block.type ?? 'text'), id: block.id, name: block.name })
        if (block.type === 'tool_use') {
          // 起始即上抛 tool-call-delta（id/name），参数增量随后
          return true
        }
        return false
      }
      if (eventName === 'content_block_delta') {
        const index = Number(data?.index ?? 0)
        const delta = data?.delta ?? {}
        const meta = openBlocks.get(index) ?? { type: 'text' }
        if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text !== '') {
          return { chunk: { type: 'text-delta', index, text: delta.text } }
        }
        if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking !== '') {
          return { chunk: { type: 'reasoning-delta', index, text: delta.thinking } }
        }
        if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string' && delta.partial_json !== '') {
          return { chunk: { type: 'tool-call-delta', index, id: meta.id ?? '', name: meta.name ?? '', argumentsDelta: delta.partial_json } }
        }
        return false
      }
      if (eventName === 'message_delta') {
        // 合并而非覆盖：message_start 可能缺 input_tokens，message_delta 可能补发
        if (data?.usage) {
          usage = usage ?? {}
          if (data.usage.output_tokens != null) usage.output_tokens = data.usage.output_tokens
          if (data.usage.input_tokens != null) usage.input_tokens = data.usage.input_tokens
          if (data.usage.cache_read_input_tokens != null) usage.cache_read_input_tokens = data.usage.cache_read_input_tokens
        }
        if (data?.delta?.stop_reason) stopReason = String(data.delta.stop_reason)
        return false
      }
      if (eventName === 'message_stop') {
        return { chunk: { type: '__done__' } }
      }
      return false
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      armIdle()
      buffer += decoder.decode(value, { stream: true })
      let sep
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        let eventName = ''
        /** @type {any} */
        let data = null
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          else if (line.startsWith('data:')) {
            const payload = line.slice(5).trim()
            try { data = JSON.parse(payload) } catch { data = payload }
          }
        }
        if (eventName === 'ping' || data === null) continue
        sawFirstData = true
        const out = handleEvent(eventName, data)
        if (out === true) {
          // tool_use 块起始：上抛 tool-call-delta 起始帧
          const index = Number(data?.index ?? 0)
          const block = data?.content_block ?? {}
          yield { type: 'tool-call-delta', index, id: String(block.id ?? ''), name: String(block.name ?? ''), argumentsDelta: '' }
        } else if (out && typeof out === 'object' && out.chunk) {
          if (out.chunk.type === '__done__') {
            // 收尾：usage + finish
            const u = usage ?? {}
            const cacheRead = Number(u.cache_read_input_tokens ?? 0)
            const inputTok = Number(u.input_tokens ?? 0)
            const outputTok = Number(u.output_tokens ?? 0)
            yield {
              type: 'usage',
              usage: {
                inputTokens: inputTok,
                outputTokens: outputTok,
                totalTokens: inputTok + cacheRead + outputTok,
                cacheReadTokens: cacheRead,
                cacheWriteTokens: 0,
              },
            }
            const reason = stopReason === 'tool_use' ? { kind: 'tool-calls' }
              : stopReason === 'max_tokens' ? { kind: 'max-tokens' }
              : { kind: 'stop' }
            yield { type: 'finish', reason }
            return
          }
          yield out.chunk
        }
      }
    }
    // 流意外收尾（无 message_stop）：若已有 usage 也照常收束
    if (usage) {
      const u = usage
      const cacheRead = Number(u.cache_read_input_tokens ?? 0)
      const inputTok = Number(u.input_tokens ?? 0)
      const outputTok = Number(u.output_tokens ?? 0)
      yield {
        type: 'usage',
        usage: { inputTokens: inputTok, outputTokens: outputTok, totalTokens: inputTok + cacheRead + outputTok, cacheReadTokens: cacheRead, cacheWriteTokens: 0 },
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    throw Object.assign(new Error(sawFirstData ? '直连流在完成前中断' : '直连流未返回任何数据'), { code: 'DIRECT_HTTP' })
  } catch (error) {
    // 异常分流：用户中止原样上抛；空闲超时/网络错误编码为 DIRECT_* 供适配器记账
    if (error?.name === 'AbortError' && input.signal?.aborted) throw error
    if (error?.message === 'idle') {
      throw Object.assign(new Error('直连通道空闲超时（无数据超过 120s）'), { code: 'DIRECT_IDLE' })
    }
    if (error?.code === 'GATE_3012' || error?.code === 'DIRECT_HTTP' || error?.code === 'DIRECT_IDLE') throw error
    throw Object.assign(new Error(`直连流读取失败：${error instanceof Error ? error.message : String(error)}`), { code: 'DIRECT_HTTP' })
  } finally {
    for (const fn of cleanups) { try { fn() } catch {} }
    try { await reader.cancel() } catch {}
    clearTimeout(idleTimer)
  }
}
