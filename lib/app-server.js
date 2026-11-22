/**
 * ZCode app-server 客户端（stdio JSON-RPC）。
 *
 * 设计要点：**插件永远不自己拼模型请求**。
 *
 * 事实依据（本机实测 2026-11-18，ZCode 3.18.2）：
 *   - 任何自建 HTTP 请求打到 `/api/v1/zcode-plan/anthropic/v1/messages`
 *     一律 405 / `3012 This client is not supported`。
 *   - `ultra*` 路由要 OAuth access token，而本机凭据里只有过期的
 *     `oauth:zai_cn:access_token`，没有 refresh_token，刷新不了。
 *   - 带 `codingPlanSignature.enable = true`，需要客户端签名握手。
 *
 * 所以模型流量必须由官方 CLI 发出：它持有完整的凭证链、签名管线与
 * 人机验证组件。本客户端只负责把 DSH 的请求翻译成 CLI 的
 * `session/send`，再把 `session/event` 翻回来。
 *
 * 协议实测形状：
 *   请求   {id, method, params}          —— 没有 jsonrpc 字段
 *   通知   {method, params}
 *   响应   {id, result|error}
 *
 *   session/create {workspace:{workspacePath, workspaceKey}}
 *     -> result.session.sessionId, result.settings.model.available
 *   服务端请求 session/requestRuntimePreferences
 *     -> 必须回 {nativeSearchEnhancementsEnabled, memoryEnabled,
 *                askUserQuestionAutoResolutionEnabled, modelContextBudgetStrategy}
 *        modelContextBudgetStrategy 只接受 'legacy' | 'preflight-v1'
 *   session/subscribe {sessionId, deliveryKind:'desktop-continuous', afterSeq, includeSnapshot}
 *   session/setModel {sessionId, model:{providerId, modelId, options?:{reasoningLevel}}}
 *   session/send {sessionId, content}
 *
 *   事件 session/event，type 在 params 顶层，数据在 params.payload：
 *     turn.started | model.streaming{kind,delta,done}
 *     | turn.completed{response,usage,resultType} | turn.failed{error}
 *     | session.updated（携带 providerId / baseURL，可观测烧的是哪个通道）
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { resolveNodeBinary } from './credentials.js'

/** @param {string} code @param {string} message */
function aerr(code, message) {
  const e = /** @type {Error & { code: string }} */ (new Error(message))
  e.code = code
  return e
}

/** 运行时偏好：CLI 会主动问，不回就无法继续。 */
const RUNTIME_PREFERENCES = {
  nativeSearchEnhancementsEnabled: false,
  memoryEnabled: false,
  askUserQuestionAutoResolutionEnabled: true,
  modelContextBudgetStrategy: 'legacy',
}

export class AppServerClient {
  /**
   * @param {{
   *   cliPath: string,
   *   cliNode?: string,
   *   cwd?: string,
   *   dataBaseDir?: string,
   *   logger?: any,
   *   captcha?: () => { param: string, region?: string } | null,
   * }} options
   */
  constructor(options) {
    this.options = options
    /** @type {import('node:child_process').ChildProcess | null} */
    this.child = null
    this.starting = /** @type {Promise<void> | null} */ (null)
    this.buffer = ''
    this.nextId = 1
    /** @type {Map<number, { resolve: (v:any)=>void, reject: (e:any)=>void, timer: any, method: string }>} */
    this.pending = new Map()
    /** @type {Set<(msg:any)=>void>} */
    this.listeners = new Set()
    /** @type {Set<(code: number | null, signal: string | null) => void>} */
    this.exitListeners = new Set()
    /** @type {string[]} */
    this.stderrTail = []
    this.ready = false
  }

  get logger() {
    return this.options.logger ?? console
  }

  /** 启动并等到 startup/storageState 到达 ready。@returns {Promise<void>} */
  async ensureStarted() {
    if (this.ready && this.child !== null && this.child.exitCode === null) return
    if (this.starting !== null) return this.starting
    this.starting = this.start().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  /** @returns {Promise<void>} */
  async start() {
    const { cliPath, cliNode, cwd, dataBaseDir } = this.options
    if (!fs.existsSync(cliPath)) {
      throw aerr('CLI_NOT_FOUND', `找不到 ZCode CLI：${cliPath}`)
    }
    const env = { ...process.env }
    delete env.ZCODE_CLI_CREDENTIALS_FILE
    delete env.ZCODE_CLI_SETTINGS_FILE
    delete env.ZCODE_CREDENTIAL_SECRET
    if (dataBaseDir) env.ZCODE_DATA_BASE_DIR = dataBaseDir
    // 注入 ZCODE_APP_VERSION，防止 upstream 报 3012（This client is not supported）
    env.ZCODE_APP_VERSION = process.env.ZCODE_APP_VERSION || this.options.cliVersion || '3.19.0'
    // 桌面端内核不带 provider/zcode-builtin.json；npm 完整包带。
    // 只有带 builtin 的内核才能解析出 account:zai-* 通道。
    const builtin = path.join(path.dirname(cliPath), 'provider', 'zcode-builtin.json')
    if (fs.existsSync(builtin)) env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtin
    // 凭据密钥文件注入：优先使用当前数据根的 credential-secret，兜底使用全局受管密钥。
    if (dataBaseDir) {
      const secretFile = path.join(dataBaseDir, '.zcode', 'v2', 'credential-secret')
      if (fs.existsSync(secretFile)) {
        env.ZCODE_CREDENTIAL_SECRET_FILE = secretFile
      }
    }
    if (!env.ZCODE_CREDENTIAL_SECRET_FILE) {
      const globalSecret = path.join(process.env.DSH_WELFARE_BASE ?? path.join(os.homedir(), '.dsh', 'dx-zcode'), 'credential-secret')
      if (fs.existsSync(globalSecret)) {
        env.ZCODE_CREDENTIAL_SECRET_FILE = globalSecret
      }
    }

    this.ready = false
    this.buffer = ''
    this.stderrTail = []
    const nodeExecutable = cliNode || resolveNodeBinary()
    if (nodeExecutable === process.execPath || String(nodeExecutable).toLowerCase().includes('deepseek harness') || String(nodeExecutable).toLowerCase().includes('electron')) {
      env.ELECTRON_RUN_AS_NODE = '1'
    }
    const child = spawn(nodeExecutable, [cliPath, 'app-server', '--stdio'], {
      cwd: cwd ?? (path.isAbsolute(cliPath) ? path.dirname(cliPath) : process.cwd()),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => this.onData(String(chunk)))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text === '') return
      this.stderrTail.push(text)
      if (this.stderrTail.length > 40) this.stderrTail.shift()
    })
    child.on('exit', (code, signal) => {
      this.ready = false
      this.child = null
      const reason = `ZCode app-server 退出（code=${code ?? '-'} signal=${signal ?? '-'}）${this.stderrTail.length ? '：' + this.stderrTail.slice(-3).join(' | ') : ''}`
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer)
        entry.reject(aerr('APP_SERVER_EXIT', reason))
      }
      this.pending.clear()
      // 通知回合层立即落地失败，不再等预算超时
      for (const listener of this.exitListeners) {
        try {
          listener(code, signal)
        } catch {
          /* 单个监听器异常不影响其它订阅者。 */
        }
      }
    })
    child.on('error', (error) => {
      this.ready = false
      this.child = null
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer)
        entry.reject(aerr('APP_SERVER_SPAWN', `启动 ZCode CLI 失败：${error.message}`))
      }
      this.pending.clear()
      for (const listener of this.exitListeners) {
        try {
          listener(null, null)
        } catch {
          /* 单个监听器异常不影响其它订阅者。 */
        }
      }
    })

    await this.waitReady()
  }

  /** 等 startup/storageState 到 ready。@returns {Promise<void>} */
  waitReady(timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      /** @param {any} msg */
      const probe = (msg) => {
        const phase = msg?.params?.phase
        if (msg?.method === 'startup/storageState' && (phase === 'ready' || phase === 'committing')) {
          this.listeners.delete(probe)
          clearTimeout(timer)
          this.ready = true
          resolve()
        }
      }
      const timer = setTimeout(() => {
        this.listeners.delete(probe)
        reject(aerr('APP_SERVER_TIMEOUT', `ZCode app-server 启动超时（${timeoutMs}ms）${this.stderrTail.length ? '：' + this.stderrTail.slice(-2).join(' | ') : ''}`))
      }, timeoutMs)
      this.listeners.add(probe)
    })
  }

  /** @param {string} chunk */
  onData(chunk) {
    this.buffer += chunk
    let index
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line === '') continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      this.dispatch(message)
    }
  }

  /** @param {any} message */
  dispatch(message) {
    // 响应：有 id 没 method
    if (message.id !== undefined && message.method === undefined) {
      const id = Number(message.id)
      const entry = this.pending.get(id)
      if (entry === undefined) return
      this.pending.delete(id)
      clearTimeout(entry.timer)
      if (message.error !== undefined) {
        entry.reject(aerr('APP_SERVER_ERROR', `${entry.method} 失败：${describeError(message.error)}`))
      } else {
        entry.resolve(message.result)
      }
      return
    }
    // 服务端请求：有 id 有 method
    if (message.id !== undefined && message.method !== undefined) {
      this.answer(message)
      return
    }
    // 通知
    if (message.method !== undefined) {
      for (const listener of this.listeners) {
        try {
          listener(message)
        } catch {
          /* 单个监听器异常不影响其它订阅者。 */
        }
      }
    }
  }

  /** @param {any} message */
  answer(message) {
    const method = String(message.method)
    if (method === 'session/requestRuntimePreferences') {
      this.write({ id: message.id, result: RUNTIME_PREFERENCES })
      return
    }
    if (method === 'interaction/requestPermission') {
      // 我们只在插件侧发请求，不存在需要用户批准的本地工具动作。
      this.write({ id: message.id, result: { behavior: 'allow' } })
      return
    }
    if (method === 'interaction/browserList') {
      this.write({ id: message.id, result: { tabs: [] } })
      return
    }
    if (method === 'interaction/browserExecute') {
      this.write({ id: message.id, error: { code: -32601, message: 'browserExecute 未实现' } })
      return
    }
    if (method === 'interaction/requestProviderRuntimeHeaders') {
      // 这是**唯一**能把验证码参数交给 CLI 的通道。
      //
      // CLI 契约（从 3.18.2 schema 实测）：
      //   { headersApplied: true, requestAuth: { headers: {…} } }
      // CLI 随后把 X-Aliyun-Captcha-Verify-Param 合进模型请求头。
      //
      // 拿不到验证码时回 headersApplied:false —— CLI 会带着 3012
      // 的明确归因失败，而不是把整个 app-server 拖死。
      const verification = this.options.captcha?.() ?? null
      if (verification === null || !verification.param) {
        this.write({
          id: message.id,
          result: { headersApplied: false, errorMessage: '验证码尚未就绪' },
        })
        return
      }
      /** @type {Record<string, string>} */
      const headers = { 'X-Aliyun-Captcha-Verify-Param': verification.param }
      if (verification.region) headers['X-Aliyun-Captcha-Verify-Region'] = verification.region
      this.write({
        id: message.id,
        result: {
          headersApplied: true,
          requestAuth: { headers },
        },
      })
      return
    }
    if (/approval|permission/i.test(method)) {
      this.write({ id: message.id, result: { behavior: 'allow' } })
      return
    }
    this.write({ id: message.id, error: { code: -32601, message: `未实现的服务端请求：${method}` } })
  }

  /** @param {any} message */
  write(message) {
    const child = this.child
    if (child === null || child.stdin === null || child.stdin.destroyed) {
      throw aerr('APP_SERVER_CLOSED', 'ZCode app-server 未运行')
    }
    child.stdin.write(JSON.stringify(message) + '\n')
  }

  /**
   * 发一个请求并等响应。
   * @param {string} method
   * @param {any} params
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  request(method, params, timeoutMs = 60000) {
    if (this.child === null) throw aerr('APP_SERVER_CLOSED', 'ZCode app-server 未运行')
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(aerr('APP_SERVER_TIMEOUT', `${method} 超时（${timeoutMs}ms）`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, method })
      try {
        this.write({ id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  /** @param {(msg:any)=>void} listener @returns {()=>void} */
  onNotification(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 订阅子进程退出/启动失败事件（回合层据此立即中止，不等超时）。
   * @param {(code: number | null, signal: string | null) => void} listener
   * @returns {() => void}
   */
  onExit(listener) {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  /** 关闭进程。@returns {void} */
  dispose() {
    const child = this.child
    this.child = null
    this.ready = false
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(aerr('APP_SERVER_CLOSED', 'app-server 已关闭'))
    }
    this.pending.clear()
    if (child !== null) {
      try {
        child.stdin?.end()
        child.kill()
      } catch {
        /* 进程可能已退出。 */
      }
    }
  }
}

/** @param {any} error @returns {string} */
function describeError(error) {
  if (error === null || typeof error !== 'object') return String(error)
  const data = error.data
  if (data !== null && typeof data === 'object' && typeof data.message === 'string') return data.message
  return String(error.message ?? JSON.stringify(error))
}

// ── 目录 / 会话 ───────────────────────────────────────────────────────────────

/**
 * 打开一个会话并读回模型目录。
 * @param {AppServerClient} client
 * @param {{ workspacePath?: string, workspaceKey?: string }} [workspace]
 * @returns {Promise<{ sessionId: string, models: any[], raw: any }>}
 */
export async function createSession(client, workspace = {}) {
  /** @type {any} */
  const payload = {
    mode: workspace.mode ?? 'yolo',
    workspace: {
      workspacePath: workspace.workspacePath ?? process.cwd(),
      workspaceKey: workspace.workspaceKey ?? `dsh-${randomUUID()}`,
    },
  }
  // 仅在明确指定 toolAllowlist 数组时传参限制；默认缺省以启用 ZCode 完整内置工具链（read_file/edit_file/write_file/command_run）
  if (Array.isArray(workspace.toolAllowlist)) {
    payload.toolAllowlist = workspace.toolAllowlist
  }
  if (Array.isArray(workspace.toolDenylist)) {
    payload.toolDenylist = workspace.toolDenylist
  }
  const result = await client.request('session/create', payload, 120000)
  const sessionId = String(result?.session?.sessionId ?? '')
  if (sessionId === '') throw aerr('SESSION_CREATE', 'session/create 没有返回 sessionId')
  const available = result?.settings?.model?.available
  return {
    sessionId,
    models: Array.isArray(available) ? available : [],
    raw: result?.settings?.model ?? {},
  }
}

/**
 * 切到指定 provider/model。
 * @param {AppServerClient} client
 * @param {string} sessionId
 * @param {{ providerId: string, modelId: string, reasoningLevel?: string }} model
 * @returns {Promise<void>}
 */
export async function setModel(client, sessionId, model) {
  /** @type {any} */
  const payload = { providerId: model.providerId, modelId: model.modelId }
  const isTurbo = String(model.modelId).toLowerCase().includes('turbo')
  const defaultReasoning = isTurbo ? 'enabled' : 'max'
  payload.options = { reasoningLevel: model.reasoningLevel || defaultReasoning }
  await client.request('session/setModel', { sessionId, model: payload }, 30000)
}

/** @param {AppServerClient} client @param {string} sessionId @returns {Promise<void>} */
export async function subscribe(client, sessionId) {
  await client.request('session/subscribe', {
    sessionId,
    deliveryKind: 'desktop-continuous',
    includeSnapshot: false,
  }, 30000)
}

/**
 * 发送一轮对话。
 * @param {AppServerClient} client
 * @param {string} sessionId
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function send(client, sessionId, text) {
  await client.request('session/send', {
    sessionId,
    // CLI schema 要求 content 是纯字符串（不是 content block 数组）。
    content: text,
  }, 30000)
}

/**
 * 优雅关闭并释放会话，防止插件宿主子进程泄漏
 * @param {AppServerClient} client
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function closeSession(client, sessionId) {
  if (!client || !sessionId) return
  try {
    await client.request('session/close', { sessionId }, 5000)
  } catch {
    /* 忽略已退出或超时的非致命异常 */
  }
}

export { aerr as appServerError }
