/**
 * 本地网关：把 ZCode 账号能力暴露成 OpenAI / Anthropic 双协议 HTTP 服务。
 *
 * 关键约束（实测）：模型流量**只能**由官方 CLI 发出，任何自建 HTTP 请求
 * 到 zcode-plan 模型端点都会被 3012 拒绝。所以本网关不做「HTTP 转发」，
 * 而是每个请求开一个 app-server 会话，把 prompt 交给 CLI 执行。
 *
 * 因此本网关的能力边界要讲清楚：
 *   - 支持：文本对话、流式输出、多轮（每次请求自包含 history）
 *   - 不支持：工具调用透传（CLI 自己的工具集不对外）、图片（除非 CLI 支持）
 *
 * 端口默认 8788，绑定 127.0.0.1。可设 authToken 做简单鉴权。
 */

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createSession, closeSession, setModel, subscribe, send } from './app-server.js'
import { tokensOf } from './calllog.js'

/** 回环地址集合（A2）。 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/** 网关会话工作区（A2）：独立 scratch 目录，绝不用宿主 cwd（可能是安装目录）。 */
const GATEWAY_SCRATCH = path.join(
  process.env.DSH_WELFARE_BASE ?? path.join(os.homedir(), '.dsh', 'dx-zcode'),
  'gateway-scratch',
)
function ensureScratch() {
  try { fs.mkdirSync(GATEWAY_SCRATCH, { recursive: true }) } catch {}
  return GATEWAY_SCRATCH
}

/**
 * @typedef {object} GatewayOptions
 * @property {number} port
 * @property {string} host
 * @property {string} authToken 空 = 不校验
 * @property {() => { client: any, account: any, model: any } | null} resolveRoute
 * @property {any} logger
 * @property {any} [callLog] 调用记录
 */

/** 上下文超限等不可重试错误码。 */
const FATAL_CODES = new Set(['CONTEXT_WINDOW_EXCEEDED', 'AUTH', 'APP_SERVER_CLOSED'])

export class Gateway {
  /** @param {GatewayOptions} options */
  constructor(options) {
    this.options = options
    /** @type {http.Server | null} */
    this.server = null
    this.startedAt = 0
    this.requests = 0
    this.failures = 0
    this.running = false
  }

  get logger() {
    return this.options.logger ?? console
  }

  /** @returns {Promise<{ port: number, host: string }>} */
  async start() {
    if (this.running) return { port: this.options.port, host: this.options.host }
    // A2：非回环绑定必须显式配置鉴权密钥，否则拒绝启动——
    // 不把付费账号代理裸露到局域网
    const bindHost = String(this.options.host ?? '127.0.0.1')
    if (!LOOPBACK_HOSTS.has(bindHost) && this.options.authToken === '') {
      throw new Error(`网关绑定非回环地址（${bindHost}）时必须配置 gatewayAuthToken，已拒绝启动`)
    }
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        this.failures++
        this.sendJson(res, 500, { error: { message: error instanceof Error ? error.message : String(error), type: 'internal_error' } })
      })
    })
    server.keepAliveTimeout = 65000
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.options.port, this.options.host, () => resolve(undefined))
    })
    this.server = server
    this.running = true
    this.startedAt = Date.now()
    this.logger.info?.(`[dx-zcode] 网关已启动 http://${this.options.host}:${this.options.port}`)
    return { port: this.options.port, host: this.options.host }
  }

  /** @returns {Promise<void>} */
  async stop() {
    const server = this.server
    this.server = null
    this.running = false
    if (server === null) return
    await new Promise((resolve) => server.close(() => resolve(undefined)))
  }

  /** @returns {{ running: boolean, port: number, host: string, uptimeMs: number, requests: number, failures: number, authRequired: boolean }} */
  status() {
    return {
      running: this.running,
      port: this.options.port,
      host: this.options.host,
      uptimeMs: this.startedAt === 0 ? 0 : Date.now() - this.startedAt,
      requests: this.requests,
      failures: this.failures,
      authRequired: this.options.authToken !== '',
    }
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    // 健康检查不需要鉴权
    if (url.pathname === '/health') {
      this.sendJson(res, 200, { ok: true, ...this.status() })
      return
    }
    // A2：Host 栅栏——DNS rebinding 页面的 Host 是攻击者域名，与配置端口
    // 不匹配即拒绝。注意 Origin 类校验对 rebinding 无效（攻击页 origin ===
    // host 会放行），Host 校验才是有效防线。
    {
      const bindHost = String(this.options.host ?? '127.0.0.1')
      const port = this.options.port
      const allowedHosts = LOOPBACK_HOSTS.has(bindHost)
        ? ['127.0.0.1', 'localhost', '[::1]']
        : [bindHost]
      const expected = new Set(allowedHosts.map((h) => `${h}:${port}`.toLowerCase()))
      const hostHeader = String(req.headers.host ?? '').trim().toLowerCase()
      if (hostHeader === '' || !expected.has(hostHeader)) {
        this.sendJson(res, 403, { error: { message: 'Host 不匹配（防 DNS rebinding）', type: 'forbidden' } })
        return
      }
    }
    if (this.options.authToken !== '') {
      const given = bearer(req) ?? String(req.headers['x-api-key'] ?? '')
      if (given !== this.options.authToken) {
        this.sendJson(res, 401, { error: { message: '网关密钥不正确', type: 'authentication_error' } })
        return
      }
    }
    if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
      this.sendJson(res, 200, { object: 'list', data: this.listModels() })
      return
    }
    if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
      await this.handleOpenAI(req, res)
      return
    }
    if (req.method === 'POST' && (url.pathname === '/v1/messages' || url.pathname === '/messages')) {
      await this.handleAnthropic(req, res)
      return
    }
    this.sendJson(res, 404, { error: { message: `未知路径：${url.pathname}`, type: 'not_found' } })
  }

  /** @returns {any[]} */
  listModels() {
    if (typeof this.options.listModels === 'function') {
      const list = this.options.listModels()
      if (Array.isArray(list) && list.length > 0) {
        return list
          .filter((m) => m.enabled !== false)
          .map((m) => ({
            id: m.id || m.modelId,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'zcode',
          }))
      }
    }
    const route = this.options.resolveRoute()
    if (route === null) return []
    return [{ id: route.model.modelId, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'zcode' }]
  }

  /**
   * B7：网关侧账号级 failover——与 provider 路径同语义，失败换号重试。
   * @param {string} sessionId
   * @param {string | undefined} requestedModel
   * @param {(route: any) => Promise<any>} fn
   * @param {number} [maxAttempts]
   * @returns {Promise<{ route: any, result: any }>}
   */
  async withFailover(sessionId, requestedModel, fn, maxAttempts = 4) {
    const exclude = new Set()
    let lastError = null
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const route = this.options.resolveRoute(requestedModel, sessionId, exclude)
      if (route === null) break
      try {
        const result = await fn(route)
        return { route, result }
      } catch (error) {
        if (route.account?.id) exclude.add(route.account.id)
        error.routeAccount = route.account
        error.routeModelId = route.model?.modelId
        lastError = error
        this.logger.warn?.(`[dx-zcode] 网关账号调用失败，尝试备用账号：${messageOf(error)}`)
      }
    }
    if (lastError !== null) throw lastError
    throw new Error('没有可用账号，请先在面板添加并登录 ZCode 账号')
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async handleOpenAI(req, res) {
    const body = await readJson(req)
    if (body === null) {
      this.sendJson(res, 400, { error: { message: '请求体不是合法 JSON', type: 'invalid_request_error' } })
      return
    }
    const stream = body.stream === true
    const prompt = openAIToPrompt(body)
    const requestedModel = typeof body.model === 'string' ? body.model : undefined
    const sessionId = typeof body.user === 'string' ? body.user : (typeof body.conversation_id === 'string' ? body.conversation_id : (Array.isArray(body.messages) && body.messages[0] ? (typeof body.messages[0].content === 'string' ? body.messages[0].content.slice(0, 100) : '') : ''))
    if (this.options.resolveRoute(requestedModel, sessionId) === null) {
      this.sendJson(res, 503, { error: { message: '没有可用账号，或所选模型不存在/已停用', type: 'unavailable' } })
      return
    }
    this.requests++

    if (!stream) {
      const startedAt = Date.now()
      try {
        const { route, result } = await this.withFailover(sessionId, requestedModel, (r) => runTurn(r, prompt, this.logger))
        const { text, usage } = result
        this.options.callLog?.push({
          accountId: route.account?.id ?? '',
          account: route.account?.id ?? route.account?.provider ?? '—',
          model: body.model ?? route.model.modelId,
          kind: 'gateway',
          ok: true,
          durationMs: Date.now() - startedAt,
          tokens: tokensOf(usage),
        })
        this.sendJson(res, 200, {
          id: `chatcmpl-${randomUUID()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model ?? route.model.modelId,
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: usage === null
            ? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            : { prompt_tokens: usage.input ?? 0, completion_tokens: usage.output ?? 0, total_tokens: usage.total ?? 0 },
        })
      } catch (error) {
        this.failures++
        this.options.callLog?.push({
          accountId: error.routeAccount?.id ?? '',
          account: error.routeAccount?.id ?? error.routeAccount?.provider ?? '—',
          model: body.model ?? error.routeModelId ?? '—',
          kind: 'gateway',
          ok: false,
          durationMs: Date.now() - startedAt,
          error: messageOf(error),
        })
        this.sendJson(res, 502, { error: { message: messageOf(error), type: 'upstream_error' } })
      }
      return
    }

    // 流式（B7：换号 failover——但正文一旦外发就不再换，避免内容重复）
    const startedAt = Date.now()
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    const id = `chatcmpl-${randomUUID()}`
    const writeChunk = (payload) => res.write(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: body.model ?? '—',
      ...payload,
    })}\n\n`)
    let emitted = 0
    let usage = null
    let lastRoute = null
    let lastError = null
    let succeeded = false
    const exclude = new Set()
    for (let attempt = 0; attempt < 4; attempt++) {
      const route = this.options.resolveRoute(requestedModel, sessionId, exclude)
      if (route === null) break
      lastRoute = route
      try {
        usage = await streamTurn(route, prompt, (delta) => {
          emitted++
          writeChunk({ choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })
        }, this.logger)
        succeeded = true
        break
      } catch (error) {
        lastError = error
        if (emitted > 0) break
        if (route.account?.id) exclude.add(route.account.id)
        this.logger.warn?.(`[dx-zcode] 网关账号调用失败，尝试备用账号：${messageOf(error)}`)
      }
    }
    if (succeeded) {
      this.options.callLog?.push({
        accountId: lastRoute?.account?.id ?? '',
        account: lastRoute?.account?.id ?? lastRoute?.account?.provider ?? '—',
        model: body.model ?? lastRoute?.model?.modelId ?? '—',
        kind: 'gateway',
        ok: true,
        durationMs: Date.now() - startedAt,
        tokens: tokensOf(usage),
      })
      writeChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      res.write('data: [DONE]\n\n')
    } else {
      this.failures++
      this.options.callLog?.push({
        accountId: lastRoute?.account?.id ?? '',
        account: lastRoute?.account?.id ?? lastRoute?.account?.provider ?? '—',
        model: body.model ?? lastRoute?.model?.modelId ?? '—',
        kind: 'gateway',
        ok: false,
        durationMs: Date.now() - startedAt,
        error: messageOf(lastError),
      })
      res.write(`data: ${JSON.stringify({ error: { message: lastError ? messageOf(lastError) : '没有可用账号', type: 'upstream_error' } })}\n\n`)
    }
    res.end()
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async handleAnthropic(req, res) {
    const body = await readJson(req)
    if (body === null) {
      this.sendJson(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: '请求体不是合法 JSON' } })
      return
    }
    const stream = body.stream === true
    const prompt = anthropicToPrompt(body)
    const requestedModel = typeof body.model === 'string' ? body.model : undefined
    const sessionId = typeof body.user_id === 'string' ? body.user_id : (Array.isArray(body.messages) && body.messages[0] ? (typeof body.messages[0].content === 'string' ? body.messages[0].content.slice(0, 100) : '') : '')
    if (this.options.resolveRoute(requestedModel, sessionId) === null) {
      this.sendJson(res, 503, { type: 'error', error: { type: 'overloaded_error', message: '没有可用账号，或所选模型不存在/已停用' } })
      return
    }
    this.requests++
    const messageId = `msg_${randomUUID().replace(/-/g, '')}`
    const startedAt = Date.now()
    /** @param {any} usage */
    const anthropicUsage = (usage) => (usage === null
      ? { input_tokens: 0, output_tokens: 0 }
      : { input_tokens: usage.input ?? 0, output_tokens: usage.output ?? 0 })
    /** @param {boolean} ok @param {string | undefined} err @param {any} route */
    const record = (ok, err, route) => {
      this.options.callLog?.push({
        accountId: route?.account?.id ?? '',
        account: route?.account?.id ?? route?.account?.provider ?? '—',
        model: route?.model?.modelId ?? '—',
        kind: 'gateway',
        ok,
        durationMs: Date.now() - startedAt,
        error: err,
      })
    }

    if (!stream) {
      try {
        const { route, result } = await this.withFailover(sessionId, requestedModel, (r) => runTurn(r, prompt, this.logger))
        const { text, usage } = result
        record(true, undefined, route)
        this.sendJson(res, 200, {
          id: messageId,
          type: 'message',
          role: 'assistant',
          model: body.model ?? route.model.modelId,
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: anthropicUsage(usage),
        })
      } catch (error) {
        this.failures++
        record(false, messageOf(error), { account: error.routeAccount, model: { modelId: error.routeModelId } })
        this.sendJson(res, 502, { type: 'error', error: { type: 'api_error', message: messageOf(error) } })
      }
      return
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    write('message_start', { type: 'message_start', message: { id: messageId, type: 'message', role: 'assistant', model: body.model ?? '—', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })
    write('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    let emitted = 0
    let usage = null
    let lastRoute = null
    let lastError = null
    let succeeded = false
    const exclude = new Set()
    for (let attempt = 0; attempt < 4; attempt++) {
      const route = this.options.resolveRoute(requestedModel, sessionId, exclude)
      if (route === null) break
      lastRoute = route
      try {
        usage = await streamTurn(route, prompt, (delta) => {
          emitted++
          write('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } })
        }, this.logger)
        succeeded = true
        break
      } catch (error) {
        lastError = error
        if (emitted > 0) break
        if (route.account?.id) exclude.add(route.account.id)
        this.logger.warn?.(`[dx-zcode] 网关账号调用失败，尝试备用账号：${messageOf(error)}`)
      }
    }
    if (succeeded) {
      record(true, undefined, lastRoute)
      write('content_block_stop', { type: 'content_block_stop', index: 0 })
      write('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: anthropicUsage(usage) })
      write('message_stop', { type: 'message_stop' })
    } else {
      this.failures++
      record(false, lastError ? messageOf(lastError) : '没有可用账号', { account: lastRoute?.account, model: lastRoute?.model })
      write('error', { type: 'error', error: { type: 'api_error', message: lastError ? messageOf(lastError) : '没有可用账号' } })
    }
    res.end()
  }

  /**
   * @param {http.ServerResponse} res
   * @param {number} status
   * @param {any} payload
   */
  sendJson(res, status, payload) {
    if (res.headersSent) {
      res.end()
      return
    }
    const text = JSON.stringify(payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
    res.end(text)
  }
}

// ── 一轮对话 ──────────────────────────────────────────────────────────────────

/**
 * 跑一轮非流式对话。
 * @param {{ client: any, account: any, model: any }} route
 * @param {string} prompt
 * @param {any} logger
 * @returns {Promise<{ text: string, usage: any }>}
 */
async function runTurn(route, prompt, logger) {
  /** @type {string[]} */
  const parts = []
  const usage = await streamTurn(route, prompt, (delta) => parts.push(delta), logger)
  return { text: parts.join(''), usage }
}

/**
 * 跑一轮流式对话，逐段回调；返回 turn.completed 携带的 usage（可能为 null）。
 *
 * 每次请求独立开会话：网关是无状态的，多轮上下文由客户端在 messages 里给全。
 * @param {{ client: any, account: any, model: any }} route
 * @param {string} prompt
 * @param {(delta: string) => void} onDelta
 * @param {any} logger
 * @returns {Promise<any>}
 */
export async function streamTurn(route, prompt, onDelta, logger, timeoutMs = 600000) {
  const client = route.client
  await client.ensureStarted()
  // A2：网关会话固定使用插件自建的 scratch 工作区
  const session = await createSession(client, { workspacePath: ensureScratch() })
  let settled = false
  /** @type {any} */
  let usage = null
  /** 流式正文段数（0 = 本回合没有 text 流，需要 completion.response 兜底） */
  let emitted = 0

  /** @type {Promise<void>} */
  const done = new Promise((resolve, reject) => {
    const finish = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { off() } catch {}
      try { offExit?.() } catch {}
      fn()
    }
    const timer = setTimeout(() => {
      // B7：回合硬超时——app-server 退出或上游挂起时不再永久悬挂 socket
      finish(() => reject(new Error(`ZCode 回合超时（${Math.round(timeoutMs / 1000)}s）`)))
    }, timeoutMs)
    const off = client.onNotification((/** @type {any} */ msg) => {
      if (msg.method !== 'session/event') return
      const params = msg.params ?? {}
      if (String(params.sessionId ?? '') !== session.sessionId) return
      const type = String(params.type ?? '')
      const payload = params.payload ?? {}
      if (type === 'model.streaming') {
        // CLI 实测（3.18.2）：正文 kind='text_delta'，思考流 kind='reasoning_delta'
        const kind = String(payload.kind ?? '')
        const delta = payload.delta
        if (typeof delta === 'string' && delta !== '' && (kind === 'text' || kind === 'text_delta' || kind === '')) {
          emitted++
          onDelta(delta)
        }
        return
      }
      if (type === 'turn.completed') {
        usage = payload.usage ?? null
        finish(() => {
          // 无 text 流时用最终 response 兜底，保证非空输出
          if (emitted === 0 && typeof payload.response === 'string' && payload.response !== '') onDelta(payload.response)
          resolve()
        })
        return
      }
      if (type === 'turn.failed') {
        finish(() => reject(new Error(String(payload?.error?.message ?? payload?.message ?? 'turn.failed'))))
      }
    })
    const offExit = typeof client.onExit === 'function' ? client.onExit(() => {
      finish(() => reject(new Error('ZCode app-server 进程退出，回合中止')))
    }) : null
  })

  try {
    await subscribe(client, session.sessionId)
    // 只有当目标与当前不同才切，避免无谓的 model switch。
    const current = session.raw?.current ?? session.raw?.selected ?? null
    if (current === null || current.providerId !== route.model.providerId || current.modelId !== route.model.modelId) {
      await setModel(client, session.sessionId, route.model)
    }
    await send(client, session.sessionId, prompt)
    await done
    return usage
  } finally {
    if (session?.sessionId) {
      void closeSession(client, session.sessionId).catch(() => {})
    }
  }
}

// ── 请求体转换 ────────────────────────────────────────────────────────────────

/**
 * OpenAI chat 请求 → 单串 prompt。
 * @param {any} body
 * @returns {string}
 */
export function openAIToPrompt(body) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  /** @type {string[]} */
  const blocks = []
  for (const m of messages) {
    const role = String(m?.role ?? 'user')
    const text = contentToText(m?.content)
    if (text === '') continue
    if (role === 'system') blocks.push(text)
    else if (role === 'assistant') blocks.push(`[assistant]\n${text}`)
    else blocks.push(text)
  }
  return blocks.join('\n\n')
}

/**
 * Anthropic messages 请求 → 单串 prompt。
 * @param {any} body
 * @returns {string}
 */
export function anthropicToPrompt(body) {
  /** @type {string[]} */
  const blocks = []
  const system = contentToText(body.system)
  if (system !== '') blocks.push(system)
  const messages = Array.isArray(body.messages) ? body.messages : []
  for (const m of messages) {
    const role = String(m?.role ?? 'user')
    const text = contentToText(m?.content)
    if (text === '') continue
    if (role === 'assistant') blocks.push(`[assistant]\n${text}`)
    else blocks.push(text)
  }
  return blocks.join('\n\n')
}

/**
 * @param {any} content
 * @returns {string}
 */
function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part?.type === 'text' && typeof part.text === 'string') return part.text
      if (part?.type === 'image') return '[图片]'
      return ''
    })
    .filter((s) => s !== '')
    .join('\n')
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<any | null>}
 */
function readJson(req) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 32 * 1024 * 1024) {
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

/** @param {http.IncomingMessage} req @returns {string | null} */
function bearer(req) {
  const value = String(req.headers.authorization ?? '')
  if (!value.toLowerCase().startsWith('bearer ')) return null
  return value.slice(7).trim()
}

/** @param {any} error @returns {string} */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
