/**
 * dx-zcode — DX Zcode插件。
 *
 * 解决四个此前互相纠缠的问题：
 *
 *   ① 3012 / 风控
 *      模型流量**完全**交给官方 CLI 的 app-server 发出，插件不拼任何
 *      HTTP envelope。自建请求实测必被 3012 拒绝，这条路直接绕开。
 *
 *   ② 一键领取福利
 *      `marketing/touch` 是活动卡片的唯一来源（`billing/preview` 恒空）。
 *      领取需要 `X-Aliyun-Captcha-Verify-Param`，由验证码求解器产出。
 *
 *   ③ 多账号
 *      一个 `credentials.json` 只描述当前登录，所以账号池按**数据根**组织；
 *      支持本机登录 + 外部目录 + Z·SWITCH 账号库。
 *
 *   ④ 网关转发
 *      本地 127.0.0.1 HTTP，同时说 OpenAI 与 Anthropic 两套协议。
 *
 * 注册两个 provider：
 *   - `zcode-cli`      —— 走 app-server，模型目录由 CLI 报告
 *   - `dx-zcode`  —— 同一条通道的别名，便于按用途区分（计费归属清楚）
 */

// schemastery 是 CJS 包：ESM 下只有 default 导出，
// `import * as z` 得到的命名空间里没有 boolean/object/string，
// 会直接抛 "z.boolean is not a function"。
import z from '@deepseek-ai/schemastery'
import { LlmAdapter, RetryPolicySchema, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { AccountPool, environmentFacts } from './pool.js'
import { Gateway } from './gateway.js'
import { createSession, closeSession, setModel, subscribe, send } from './app-server.js'
import { solveCaptcha, cachedCaptcha, findBrowser, createCaptchaSession } from './captcha.js'
import { CallLog, tokensOf } from './calllog.js'
import { registerApiRoute } from './api-route.js'
import { loginWithCli } from './login.js'
import { locateCli, resolveDataBaseDir, ensureManagedSecret } from './credentials.js'
import * as directChannel from './direct-channel.js'

/** 包名；必须与 package.json 的 name 一致。 */
export const name = 'dx-zcode'

/** C9：插件版本单一来源 = package.json */
const PLUGIN_VERSION = (() => {
  try {
    return createRequire(import.meta.url)('../package.json').version || '0.1.0'
  } catch {
    return '0.1.0'
  }
})()

/** 诊断文件目录（与受管密钥/状态文件同根）。 */
const DATA_DIR = process.env.DSH_WELFARE_BASE
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME, '.dsh', 'dx-zcode')

/** 需要 `llm` 服务来注册模型 provider。 */
export const inject = ['llm']

// ── 配置 ──────────────────────────────────────────────────────────────────────

const Config = z.object({
  enabled: z.boolean().default(true).description('注册模型 provider'),
  zcodeCliPath: z.string().default('').description('zcode.cjs 绝对路径；留空自动探测'),
  zcodeDataBaseDir: z.string().default('').description('ZCode 数据根；留空读取 setting.json 的 dataBaseDir'),
  extraDataDirs: z.array(z.string()).default([]).description('额外的账号数据根（多账号）'),
  zswitchDataRoot: z.string().default('').description('Z·SWITCH 账号库根目录；留空自动探测'),
  providerId: z.string().default('dx-zcode').description('注册给 DSH 的 provider id'),
  gatewayEnabled: z.boolean().default(false).description('启动本地网关'),
  gatewayPort: z.number().step(1).min(1).max(65535).default(8788).description('网关端口'),
  gatewayHost: z.string().default('127.0.0.1').description('网关监听地址'),
  gatewayAuthToken: z.string().default('').description('网关鉴权密钥；留空不校验'),
  autoClaimMinutes: z.number().step(1).min(0).default(0).description('自动领取间隔（分钟）；0 = 关闭'),
  // 默认 30 分钟：CLI 是完整 agent（内部多步工具循环），审计/修复类回合合法耗时
  // 常超 10 分钟；挂起防护由看门狗（firstTokenMs/idleMs）承担，总超时只兜底。
  turnTimeoutMs: z.number().step(1).min(1000).default(1800000).description('单轮总超时（CLI agent 长任务默认 30 分钟）'),
  firstTokenMs: z.number().step(1).min(1000).default(120000).description('看门狗：收到首个流事件前的超时（B10）'),
  idleMs: z.number().step(1).min(1000).default(60000).description('看门狗：流事件停摆超时（B10）'),
  toolMarkerMode: z.string().default('fold-reads').description('轨迹工具标记：all=全部 / fold-reads=折叠读取类（默认）/ none=不显示'),
  channelMode: z.string().default('cli').description('模型通道：cli=官方 CLI（默认）/ direct=直连（原生体验，手动二选一）'),
  appServerTimeoutMs: z.number().step(1).min(1000).default(120000).description('app-server 请求超时'),
  // 注意：不能写 `.default({})` —— RetryPolicySchema 要求必须有 mode 字段，
  // 空对象会在 schema 校验阶段直接抛错，把整个 apply 拖垮。
  retryPolicy: RetryPolicySchema.default({ mode: 'normal' }),
})

/**
 * @typedef {object} ResolvedOptions
 * @property {boolean} enabled
 * @property {string} zcodeCliPath
 * @property {string} zcodeDataBaseDir
 * @property {string[]} extraDataDirs
 * @property {string} zswitchDataRoot
 * @property {string} providerId
 * @property {boolean} gatewayEnabled
 * @property {number} gatewayPort
 * @property {string} gatewayHost
 * @property {string} gatewayAuthToken
 * @property {number} autoClaimMinutes
 * @property {number} turnTimeoutMs
 * @property {number} appServerTimeoutMs
 * @property {any} retryPolicy
 */

/** @param {any} raw @returns {ResolvedOptions} */
export function resolveOptions(raw) {
  const r = raw ?? {}
  return {
    enabled: r.enabled !== false,
    zcodeCliPath: String(r.zcodeCliPath ?? ''),
    zcodeDataBaseDir: String(r.zcodeDataBaseDir ?? ''),
    extraDataDirs: Array.isArray(r.extraDataDirs) ? r.extraDataDirs.map(String) : [],
    zswitchDataRoot: String(r.zswitchDataRoot ?? ''),
    providerId: String(r.providerId ?? 'dx-zcode') || 'dx-zcode',
    gatewayEnabled: r.gatewayEnabled === true,
    gatewayPort: Number(r.gatewayPort ?? 8788) || 8788,
    gatewayHost: String(r.gatewayHost ?? '127.0.0.1') || '127.0.0.1',
    gatewayAuthToken: String(r.gatewayAuthToken ?? ''),
    autoClaimMinutes: Number(r.autoClaimMinutes ?? 0) || 0,
    turnTimeoutMs: Number(r.turnTimeoutMs ?? 1800000) || 1800000,
    firstTokenMs: Number(r.firstTokenMs ?? 120000) || 120000,
    idleMs: Number(r.idleMs ?? 60000) || 60000,
    toolMarkerMode: ['all', 'fold-reads', 'none'].includes(r.toolMarkerMode) ? r.toolMarkerMode : 'fold-reads',
    channelMode: r.channelMode === 'direct' ? 'direct' : 'cli',
    appServerTimeoutMs: Number(r.appServerTimeoutMs ?? 120000) || 120000,
    // 存量地雷修复：resolveRetryPolicy 需要第二个 path 参数，且仅在配置
    // 形状合法时透传——空对象/缺 mode 直接走宿主默认（normal），不再抛错
    retryPolicy: resolveRetryPolicy(
      (r.retryPolicy && typeof r.retryPolicy === 'object' && typeof r.retryPolicy.mode === 'string')
        ? r.retryPolicy
        : undefined,
      'dx-zcode',
    ),
  }
}

// ── provider 适配器 ───────────────────────────────────────────────────────────

/**
 * 将 DSH 的思考级别选择安全映射到该模型上游支持的合法枚举值。
 * @param {any} modelSpec
 * @param {string} [requestedEffort]
 * @returns {string | undefined}
 */
function resolveModelReasoningLevel(modelSpec, requestedEffort) {
  const allowed = Array.isArray(modelSpec?.reasoning?.levels)
    ? modelSpec.reasoning.levels.map((l) => String(l.value || l))
    : (Array.isArray(modelSpec?.reasoningLevels) ? modelSpec.reasoningLevels.map((l) => String(l)) : [])
  if (allowed.length === 0) return requestedEffort || modelSpec?.reasoning?.defaultLevel || undefined
  if (requestedEffort && allowed.includes(requestedEffort)) return requestedEffort
  if (requestedEffort) {
    if (requestedEffort === 'enabled') {
      if (allowed.includes('max')) return 'max'
      if (allowed.includes('high')) return 'high'
      if (allowed.includes('enabled')) return 'enabled'
      return allowed[0]
    }
    if (requestedEffort === 'off' || requestedEffort === 'disabled') {
      if (allowed.includes('disabled')) return 'disabled'
      if (allowed.includes('off')) return 'off'
      if (allowed.includes('low')) return 'low'
      return allowed[0]
    }
    if (['low', 'medium', 'high'].includes(requestedEffort) && allowed.includes('enabled')) {
      return 'enabled'
    }
    if (requestedEffort === 'max' && allowed.includes('high') && !allowed.includes('max')) {
      return 'high'
    }
  }
  return modelSpec?.reasoning?.defaultLevel || (allowed.includes('enabled') ? 'enabled' : (allowed.includes('max') ? 'max' : allowed[0]))
}

/**
 * 根据上游报错判断账号是否耗尽，若快照确认可用余额为空则标记 exhausted 并解除会话粘性。
 * @param {AccountPool} pool
 * @param {any} entry
 * @param {string} sessionId
 * @param {string} errMsg
 */
function handleQuotaError(pool, entry, sessionId, errMsg) {
  const isQuotaExceeded = /\b(1005|1309)\b/.test(errMsg) ||
    errMsg.includes('exceed quota limit') ||
    errMsg.includes('insufficient_quota') ||
    errMsg.includes('套餐已到期')
  if (!isQuotaExceeded) return false
  const snap = entry?.snapshot
  const knownEmpty = snap &&
    Number(snap.availableUnits ?? 0) === 0 &&
    (!Array.isArray(snap.balances) || snap.balances.every((b) => Number(b.available_units ?? b.remaining_units ?? 0) <= 0))
  if (knownEmpty) {
    entry.exhausted = true
    pool.update(entry.id, { exhausted: true })
    if (sessionId) pool.sessionBindings.delete(sessionId)
  }
  return true
}

/**
 * DSH 模型适配器。继承标准 LlmAdapter，提供图像定价与图像投影规范。
 * 每次 `stream()` 都通过 app-server 跑一轮，因此不存在「插件自己构造上游请求」这一步 —— 3012 的成因被移除。
 */
class ZcodeWelfareAdapter extends LlmAdapter {
  /**
   * @param {{ pool: AccountPool, options: () => ResolvedOptions, logger: any, callLog?: any }} deps
   */
  constructor(deps) {
    super()
    this.pool = deps.pool
    this.options = deps.options
    this.logger = deps.logger ?? console
    this.callLog = deps.callLog ?? null
    /** @type {Map<string, { providerId: string, modelId: string, contextWindow: number, maxOutputTokens: number, reasoningLevel?: string, reasoningLevels?: string[] }>} */
    this.modelIndex = new Map()
    /** C3：last-models-ok.json 仅在模型数量变化时落盘，避免每次查询同步写文件 */
    this._lastModelsOkCount = -1
  }

  /** @param {string} provider */
  providerInfo(provider) {
    const canonical = this.options().providerId || 'dx-zcode'
    return {
      id: provider,
      name: provider === canonical ? 'DX Zcode' : `DX Zcode (${provider})`,
    }
  }

  /** @param {string} _provider */
  providerRetryPolicy(_provider) {
    return this.options().retryPolicy
  }

  /**
   * 解析 provider 侧图像定价契约，返回 undefined 走系统默认。
   * @param {string} _provider
   * @param {string} _model
   */
  imageRequestPricing(_provider, _model) {
    return undefined
  }

  /**
   * 解析发送至模型的图像投影尺寸与字节目标。
   * @param {string} _provider
   * @param {string} _model
   * @param {any} image
   */
  imageRequestTarget(_provider, _model, image) {
    return {
      width: image?.width,
      height: image?.height,
      maxBytes: image?.bytes,
    }
  }

  /**
   * 把 CLI 报告的目录转成 DSH 模型列表。
   * @param {string} _provider
   * @returns {Promise<any[]>}
   */
  async listModels(provider) {
    let models = []
    try {
      models = await this.pool.readCatalog()
      // 对话框在池子就绪前查询会拿到空列表 —— 重试一次（load 幂等，磁盘缓存让二次查询近零成本）
      if (models.length === 0) {
        await this.pool.load().catch(() => {})
        models = await this.pool.readCatalog(true)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.logger.warn?.(`[dx-zcode] 读取模型目录失败：${detail}`)
      // 落盘诊断：DSH 运行时里的失败原因不再无声
      try {
        fs.writeFileSync(path.join(DATA_DIR, 'last-models-error.json'), JSON.stringify({ at: new Date().toISOString(), error: detail }))
      } catch { /* 诊断文件写失败忽略 */ }
      models = this.pool.getCachedModels()
      if (models.length === 0) return []
    }
    try {
      // C3：仅在数量变化时写诊断文件
      if (this._lastModelsOkCount !== models.length) {
        this._lastModelsOkCount = models.length
        fs.writeFileSync(path.join(DATA_DIR, 'last-models-ok.json'), JSON.stringify({ at: new Date().toISOString(), count: models.length }))
      }
    } catch { /* 诊断文件写失败忽略 */ }
    /** @type {any[]} */
    const out = []
    const seen = new Set()
    // 账号通道里的可用性分层：start-plan（订阅计划，plan JWT 直通）实测可靠；
    // individual-coding-plan 需要项目 API key，无订阅的账号会撞
    // project_token_invalid_response。有 start-plan 通道时只投放它的模型。
    const accountEntries = models.filter((entry) => /^account:/.test(String(entry?.ref?.providerId ?? '')))
    const hasStartPlan = accountEntries.some((entry) => String(entry.ref.providerId).includes('start-plan'))
    const routable = hasStartPlan
      ? accountEntries.filter((entry) => String(entry.ref.providerId).includes('start-plan'))
      : accountEntries
    // 1. 始终更新内存路由与参数索引（供 stream/resolveModel 内部解析）
    for (const entry of routable) {
      const ref = entry?.ref ?? {}
      const providerId = String(ref.providerId ?? '')
      const modelId = String(ref.modelId ?? '')
      if (providerId === '' || modelId === '') continue
      if (this.pool.isModelDisabled && this.pool.isModelDisabled(modelId)) continue
      const levels = Array.isArray(entry.reasoning?.levels)
        ? entry.reasoning.levels.map((l) => String(l.value ?? l)).filter(Boolean)
        : []
      const isTurbo = String(modelId).toLowerCase().includes('turbo')
      const contextWindow = Number(entry.contextWindow ?? 0) || (isTurbo ? 200000 : 1000000)
      const maxOutputTokens = Number(entry.maxOutputTokens ?? 0) || (isTurbo ? 64000 : 128000)
      this.modelIndex.set(modelId, {
        providerId,
        modelId,
        contextWindow,
        maxOutputTokens,
        // start-plan 等通道的 setModel 必须带 reasoning 档位（目录里声明了 defaultLevel）
        reasoningLevel: String(entry.reasoning?.defaultLevel ?? '') || undefined,
        reasoningLevels: levels.length > 0 ? levels : undefined,
      })
    }

    // 2. 关键修复：仅对主渠道（dx-zcode）对外投放模型目录列表。
    // 别名渠道（如 zcode-cli、dxzcode）返回空数组，避免 DSH UI 在对话框模型选择器中生成 3 个同名渠道。
    const canonical = this.options().providerId || 'dx-zcode'
    if (provider !== canonical) {
      return []
    }

    for (const entry of routable) {
      const ref = entry?.ref ?? {}
      const providerId = String(ref.providerId ?? '')
      const modelId = String(ref.modelId ?? '')
      if (providerId === '' || modelId === '' || seen.has(modelId)) continue
      if (this.pool.isModelDisabled && this.pool.isModelDisabled(modelId)) continue
      seen.add(modelId)
      const meta = this.modelIndex.get(modelId)
      // llm 服务校验：每个模型必须自带 provider 字段且 === 注册的 provider id，
      // 缺了直接 INVALID_CATALOG 抛错（对话框显示「加载失败」）。
      out.push({
        provider,
        id: modelId,
        name: String(entry.label ?? modelId),
        description: String(entry.providerLabel ?? ''),
        contextWindow: meta?.contextWindow,
        maxTokens: meta?.maxOutputTokens,
        // B9：CLI content 只收纯字符串，图片无法透传——诚实声明 text-only，
        // 避免用户发截图被静默丢弃
        inputModalities: ['text'],
      })
    }
    return out
  }

  /**
   * @param {string} provider
   * @param {string} model
   * @param {AbortSignal} [_signal]
   */
  async resolveModel(provider, model, _signal) {
    _signal?.throwIfAborted?.()
    if (this.modelIndex.size === 0) {
      await this.listModels(provider).catch(() => {})
    }
    let entry = this.modelIndex.get(model)
    if (!entry) {
      for (const [k, v] of this.modelIndex) {
        if (k.toLowerCase() === String(model).toLowerCase()) {
          entry = v
          break
        }
      }
    }
    const isTurbo = String(model).toLowerCase().includes('turbo')
    const ctx = Number(entry?.contextWindow ?? 0) || (isTurbo ? 200000 : 1000000)
    const maxTokens = Number(entry?.maxOutputTokens ?? 0) || (isTurbo ? 64000 : 128000)

    const allowed = entry?.reasoningLevels && entry.reasoningLevels.length > 0
      ? entry.reasoningLevels
      : isTurbo ? ['disabled', 'enabled'] : ['low', 'high', 'max']

    const reasoning = {
      efforts: allowed.map((lvl) => ({
        id: lvl,
        name: lvl === 'max' ? '最大 (Max)' : lvl === 'high' ? '高 (High)' : lvl === 'low' ? '低 (Low)' : lvl === 'enabled' ? '开启 (Enabled)' : lvl === 'disabled' ? '关闭 (Disabled)' : lvl,
      })),
      defaultEffort: (entry?.reasoningLevel && allowed.includes(entry.reasoningLevel)) ? entry.reasoningLevel : allowed[allowed.length - 1],
    }

    return {
      provider,
      id: model,
      name: model,
      description: 'DX Zcode 官方通道模型',
      context: { contextWindow: ctx, maxInputTokens: ctx },
      contextWindow: ctx,
      maxTokens: maxTokens,
      defaultMaxTokens: maxTokens,
      inputModalities: ['text'],
      reasoning,
      cliRoute: entry ?? null,
    }
  }

  /**
   * DSH LLM 契约：为指定 provider / model 准备调用句柄。
   * @param {string} provider
   * @param {string} model
   * @param {AbortSignal} [signal]
   */
  async prepareCall(provider, model, signal) {
    signal?.throwIfAborted?.()
    const modelInfo = await this.resolveModel(provider, model, signal)
    return {
      model: modelInfo,
      stream: (options) => this.stream(options),
    }
  }

  /**
   * 一轮流式对话。
   * @param {any} options
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  async *stream(options) {
    // 通道选择（手动二选一，不做跨通道自动回退）
    const channelMode = this.pool.getChannelMode ? this.pool.getChannelMode(this.options()) : 'cli'
    if (channelMode === 'direct') {
      yield* this.streamDirect(options)
      return
    }
    // 确保账号池在请求进入前已完成加载
    if (!this.pool.loaded || this.pool.list().length === 0) {
      await this.pool.load().catch(() => {})
    }
    const sessionId = sessionKeyOf(options)
    const prompt = promptOf(options)
    const modelId = String(options?.model ?? '')
    const reasoningEffort = options?.reasoningEffort ? String(options.reasoningEffort) : undefined
    const signal = options?.signal
    const startedAt = Date.now()
    // 目录还没读过或模型被手工指定：先读一次目录，填充 modelIndex 供 runTurn 解析路由
    if (!this.modelIndex.has(modelId)) {
      await this.listModels(this.options().providerId).catch(() => {})
    }
    /** B14：同一请求的 failover 尝试链，聚合进最终一条调用记录 */
    const attempts = []
    /** B11：零事件挂起后，后续 attempt 收缩预算为 firstTokenMs */
    let hangRetrying = false
    let routeForLog = null
    let lastError = null
    const maxAttempts = Math.max(1, this.pool.list().filter((e) => e.enabled).length)

    // 设计决策（2026-11-21）：显式选择的模型绝不静默替换。若其已知通道在
    // 全部启用账号上都被标记不可用，立即明确报「无可用额度」，不开回合。
    const knownRoute = this.modelIndex.get(modelId)
    if (knownRoute?.providerId) {
      const enabledAccounts = this.pool.list().filter((e) => e.enabled && e.account !== null)
      if (enabledAccounts.length > 0 && enabledAccounts.every((e) => this.pool.isChannelBlacklisted?.(e.id, knownRoute.providerId))) {
        const e = new Error(`所选模型 ${modelId} 在全部 ${enabledAccounts.length} 个账号上的通道均处于不可用标记中（多为额度耗尽或套餐过期）。模型不会被自动替换——请等待额度重置、续订套餐，或手动改选其他模型。`)
        this.callLog?.push({ accountId: '', account: '—', model: modelId, kind: 'provider', ok: false, durationMs: 0, error: e.message, attempts: [] })
        throw e
      }
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      signal?.throwIfAborted?.()
      // B11：单请求总预算封顶 = max(2×单轮超时, 30 分钟)——随 turnTimeoutMs 联动，
      // 长 agent 任务（30 分钟单轮）不再被 15 分钟硬上限误杀
      if (Date.now() - startedAt > Math.max(2 * this.options().turnTimeoutMs, 900000)) {
        throw lastError ?? new Error('回合总预算已耗尽（连续多账号失败）')
      }
      // 排除本请求内已尝试过的账号
      const entry = this.pool.pick(sessionId, new Set(attempts.map((a) => a.accountId)))
      if (entry === null) break

      const attemptStart = Date.now()
      entry.inFlight = (entry.inFlight ?? 0) + 1
      let emittedAny = false
      let usage = null
      try {
        for await (const chunk of this.runTurn(entry, modelId, prompt, reasoningEffort, { ...options, hangFast: hangRetrying })) {
          if (chunk?.type === 'usage') {
            usage = chunk.usage ?? usage
            routeForLog = chunk.route ?? routeForLog
          }
          if (chunk?.type === 'text' || chunk?.type === 'text-delta' || chunk?.type === 'reasoning' || chunk?.type === 'reasoning-delta') emittedAny = true
          yield chunk
        }
        if (usage && entry.snapshot && typeof entry.snapshot.availableUnits === 'number') {
          const total = Number(usage.total_tokens ?? usage.totalTokens ?? usage.total ?? 0)
          if (total > 0) {
            entry.snapshot.availableUnits = Math.max(0, entry.snapshot.availableUnits - total)
          }
        }
        // C2：回合后强刷去抖 ≥60s——乐观扣减已保证面板跟手，不必每轮 3 个上游请求
        const now = Date.now()
        if (!entry.lastForcedRefreshAt || now - entry.lastForcedRefreshAt > 60000) {
          entry.lastForcedRefreshAt = now
          this.pool?.refresh(entry, true).catch(() => {})
        }
        attempts.push({ account: entry.label, accountId: entry.id, ok: true, durationMs: Date.now() - attemptStart })
        this.callLog?.push({
          accountId: entry.id,
          account: entry.label,
          model: modelId,
          channel: 'cli',
          route: routeForLog,
          kind: 'provider',
          ok: true,
          // C10：durationMs 只计本 attempt，tps 不再被 failover 拉低
          durationMs: Date.now() - attemptStart,
          tokens: tokensOf(usage),
          attempts: attempts.slice(0, -1),
        })
        return
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        attempts.push({ account: entry.label, accountId: entry.id, ok: false, error: errMsg, durationMs: Date.now() - attemptStart })
        // B3：用户已中止——立即上抛，绝不 failover，不再烧配额
        if (signal?.aborted) {
          throw error
        }
        lastError = error
        // B13：通道级持续性失效（套餐到期/无订阅）→ 标记 (账号, 通道)，路由层直接避开
        const routePid = error?.routeProviderId ? String(error.routeProviderId) : null
        if (routePid && /1309|套餐已到期|project_token_invalid/i.test(errMsg)) {
          this.pool.markChannelUnavailable?.(entry.id, routePid)
        }
        // B8：配额判定——锚定错误码/短语，避免消息里的无关数字误伤
        handleQuotaError(this.pool, entry, sessionId, errMsg)
        this.logger.warn?.(`[dx-zcode] 账号「${entry.label}」回合调用异常：${errMsg}`)
        // 记账（紧凑制式：每次真实调用恰好一条，成功/失败都记；终态不再重复记）
        this.callLog?.push({
          accountId: entry.id,
          account: entry.label,
          model: modelId,
          channel: 'cli',
          route: routeForLog,
          kind: 'provider',
          ok: false,
          durationMs: Date.now() - attemptStart,
          error: errMsg,
        })
        // B11：零事件挂起 → 收缩下一 attempt 预算
        if (error?.firstTokenSeen === false && /超时|停摆|挂起/.test(errMsg)) hangRetrying = true
        // 若尚未向客户端发出任何正文/思考流内容，执行无缝故障转移（Failover）
        if (!emittedAny) {
          this.logger.info?.(`[dx-zcode] 会话 ${sessionId || 'default'} 正在自动故障转移（Failover）至备用账号...`)
          continue
        }
        throw error
      } finally {
        // B12：在途回合计数回收
        entry.inFlight = Math.max(0, (entry.inFlight ?? 1) - 1)
      }
    }

    const allAccounts = this.pool.list()
    if (allAccounts.length === 0) {
      throw Object.assign(new Error('没有可用 ZCode 账号。请先在 DX Zcode 控制面板登录国内站或国际站。'), { code: 'NO_ACCOUNT' })
    }
    if (lastError) {
      const msg = lastError instanceof Error ? lastError.message : String(lastError)
      // 记账已在上方 attempt catch 中完成（每次真实调用恰好一条），终态不再重复记
      if (msg.includes('exceed quota limit') || msg.includes('insufficient_quota') || /\b(1005|1309)\b/.test(msg)) {
        // 设计决策：明确报「所选模型无可用额度」，绝不静默替换模型
        throw new Error(`所选模型 ${modelId} 在当前所有 ${allAccounts.length} 个账号上均无可用额度（最近上游错误：${msg.slice(0, 180)}）。模型不会被自动替换——请等待额度重置、续订套餐，或手动改选其他模型。`)
      }
      throw lastError
    }
    this.callLog?.push({
      accountId: '',
      account: '—',
      model: modelId,
      kind: 'provider',
      ok: false,
      durationMs: Date.now() - startedAt,
      error: '没有可用账号',
    })
    throw new Error(`当前所有已登录 ZCode 账号（共 ${allAccounts.length} 个）均不可用，请在控制面板检查账号状态。`)
  }

  /**
   * 直连通道（direct）：自建 HTTP 直打 anthropic 端点，DSH 原生 agent 循环 + 原生工具卡片。
   * 每次调用 = 一次 LLM 请求（agent 循环由 DSH 驱动），账号级 failover 保留；
   * 3012（信封漂移）与账号无关 → 快速失败并明确指引切回 CLI，不做跨通道回退。
   * @param {any} options
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  async *streamDirect(options) {
    if (!this.pool.loaded || this.pool.list().length === 0) {
      await this.pool.load().catch(() => {})
    }
    const sessionId = sessionKeyOf(options)
    const modelId = String(options?.model ?? '')
    const signal = options?.signal
    const startedAt = Date.now()
    const maxTokens = Number(options?.maxTokens) || 32768
    const attempts = []
    let routeForLog = { channel: 'direct', modelId }
    let lastError = null
    const maxAttempts = Math.max(1, this.pool.list().filter((e) => e.enabled).length)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      signal?.throwIfAborted?.()
      const entry = this.pool.pick(sessionId, new Set(attempts.map((a) => a.accountId)))
      if (entry === null) break
      if (entry.account === null) {
        attempts.push({ account: entry.label, accountId: entry.id, ok: false, error: '无可用凭据', durationMs: 0 })
        continue
      }

      const attemptStart = Date.now()
      entry.inFlight = (entry.inFlight ?? 0) + 1
      let emittedAny = false
      let usage = null
      try {
        for await (const chunk of directChannel.streamDirectCall({
          planToken: entry.account.planToken,
          deviceMid: entry.account.deviceMid,
          appVersion: entry.account.cliVersion,
          modelId,
          maxTokens,
          system: systemTextOf(options),
          tools: options?.tools,
          messages: Array.isArray(options?.messages) ? options.messages : [],
          signal,
        })) {
          if (chunk?.type === 'usage') usage = chunk.usage ?? usage
          if (chunk?.type === 'text-delta' || chunk?.type === 'reasoning-delta' || chunk?.type === 'tool-call-delta') emittedAny = true
          yield chunk
        }
        if (usage && entry.snapshot && typeof entry.snapshot.availableUnits === 'number') {
          const total = Number(usage.totalTokens ?? 0)
          if (total > 0) entry.snapshot.availableUnits = Math.max(0, entry.snapshot.availableUnits - total)
        }
        attempts.push({ account: entry.label, accountId: entry.id, ok: true, durationMs: Date.now() - attemptStart })
        this.callLog?.push({
          accountId: entry.id,
          account: entry.label,
          model: modelId,
          channel: 'direct',
          route: routeForLog,
          kind: 'provider',
          ok: true,
          durationMs: Date.now() - attemptStart,
          tokens: tokensOf(usage),
          attempts: attempts.slice(0, -1),
        })
        return
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        attempts.push({ account: entry.label, accountId: entry.id, ok: false, error: errMsg, durationMs: Date.now() - attemptStart })
        if (signal?.aborted) {
          throw error
        }
        lastError = error
        // 记账（紧凑制式：每次真实调用恰好一条，成功/失败都记；终态不再重复记）
        this.callLog?.push({
          accountId: entry.id,
          account: entry.label,
          model: modelId,
          channel: 'direct',
          route: routeForLog,
          kind: 'provider',
          ok: false,
          durationMs: Date.now() - attemptStart,
          error: errMsg,
        })
        this.logger.warn?.(`[dx-zcode] 直连账号「${entry.label}」调用异常：${errMsg}`)
        handleQuotaError(this.pool, entry, sessionId, errMsg)
        // 3012 = 信封漂移，与账号无关 → 快速失败，不做无意义的逐号重试
        if (error?.code === 'GATE_3012') {
          throw new Error(`直连通道被 3012 拒绝（官方客户端信封可能已漂移）。按「选择哪个就用哪个」原则已停止，不会静默切换——请在面板把模型通道切回「CLI」。上游归因：${errMsg}`)
        }
        if (!emittedAny) continue
        throw error
      } finally {
        entry.inFlight = Math.max(0, (entry.inFlight ?? 1) - 1)
      }
    }

    if (lastError) {
      const msg = lastError instanceof Error ? lastError.message : String(lastError)
      if (msg.includes('exceed quota limit') || msg.includes('insufficient_quota') || /\b(1005|1309)\b/.test(msg)) {
        const allCount = this.pool.list().length
        throw new Error(`所选模型 ${modelId} 在当前所有 ${allCount} 个账号上均无可用额度（最近上游错误：${msg.slice(0, 180)}）。请等待额度重置或切换模型。`)
      }
      throw lastError
    }
    this.callLog?.push({
      accountId: '',
      account: '—',
      model: modelId,
      kind: 'provider',
      ok: false,
      durationMs: Date.now() - startedAt,
      error: '没有可用账号（直连）',
    })
    throw Object.assign(new Error('直连通道没有可用账号。请先在面板添加并登录 ZCode 账号，或切换回 CLI 通道。'), { code: 'NO_ACCOUNT' })
  }

  /**
   * 实际跑一轮，与 stream() 分离以便统一记账。
   * @param {any} entry
   * @param {string} modelId
   * @param {string} prompt
   * @param {string} [reasoningEffort]
   * @param {any} [options]
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  async *runTurn(entry, modelId, prompt, reasoningEffort, options = {}) {
    const client = this.pool.clientFor(entry)
    await client.ensureStarted()
    const targetSessionId = options?.sessionId || sessionKeyOf(options)
    const workspacePath = resolveWorkspacePath(targetSessionId)
    const session = await createSession(client, { workspacePath })

    const opts = this.options()
    const firstTokenMs = opts.firstTokenMs ?? 120000
    const idleMs = opts.idleMs ?? 60000
    // B11：挂起重试时整轮预算收缩为 firstTokenMs
    const hangFast = options?.hangFast === true
    const totalBudgetMs = hangFast ? firstTokenMs : (opts.turnTimeoutMs ?? 600000)

    /** @type {Array<() => void>} */
    const cleanups = []
    /** @type {any[]} */
    const queue = []
    let notify = () => {}
    let failure = null
    let finished = false
    // B10：看门狗状态——任意事件刷新；firstTokenSeen 区分「未起流挂起」与「流中停摆」
    let lastEventAt = Date.now()
    let firstTokenSeen = false
    // 轨迹降噪：读取类工具的突发标记状态（连续 Read 只报一次）
    let readBurstEmitted = false
    /** B13/B14：当前生效路由，随失败上抛（通道黑名单）、随 usage 回传（调用记录） */
    let routeInfo = null

    const wake = () => {
      const n = notify
      notify = () => {}
      n()
    }

    const off = client.onNotification((/** @type {any} */ msg) => {
      if (msg.method !== 'session/event') return
      const params = msg.params ?? {}
      if (String(params.sessionId ?? '') !== session.sessionId) return
      const type = String(params.type ?? '')
      // B10：任何会话事件都刷新看门狗
      lastEventAt = Date.now()
      firstTokenSeen = true
      const payload = params.payload ?? {}
      if (type === 'model.streaming') {
        // CLI 实测（3.18.2）：正文 kind='text_delta'，思考流 kind='reasoning_delta'
        const delta = payload.delta
        if (typeof delta === 'string' && delta !== '') {
          const kind = String(payload.kind ?? '')
          if (kind === 'reasoning' || kind === 'reasoning_delta' || kind === 'thinking') queue.push({ type: 'reasoning', text: delta })
          else if (kind === 'text' || kind === 'text_delta' || kind === '') queue.push({ type: 'text', text: delta })
          wake()
        }
        return
      }
      if (type === 'tool.updated') {
        const kind = String(payload.kind ?? '')
        const toolName = payload.toolName || payload.name || payload.tool || ''
        // 轨迹降噪：读取类工具折叠为一次突发标记，只高亮写入/命令类工具
        const markerMode = opts.toolMarkerMode ?? 'fold-reads'
        const isReadTool = /read|grep|glob|list|search|view|open|fetch/i.test(String(toolName))
        if (markerMode === 'none') return
        if (kind === 'started') {
          if (markerMode === 'fold-reads' && isReadTool) {
            if (!readBurstEmitted) {
              readBurstEmitted = true
              queue.push({ type: 'text', text: `\n\n> 📖 **[读取文件中]** …\n\n` })
              wake()
            }
            return
          }
          readBurstEmitted = false
          queue.push({ type: 'text', text: `\n\n> 🛠️ **[ZCode 执行工具]** \`${toolName || '工具'}\`...\n\n` })
          wake()
        } else if (kind === 'result') {
          if (markerMode === 'fold-reads' && isReadTool) return
          readBurstEmitted = false
          queue.push({ type: 'text', text: `\n> ✅ **[工具完成]** \`${toolName || '工具'}\`\n\n` })
          wake()
        } else if (kind === 'error') {
          readBurstEmitted = false
          const err = payload.error ? (typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error)) : '失败'
          queue.push({ type: 'text', text: `\n> ⚠️ **[工具执行异常]** \`${toolName || '工具'}\`: ${err}\n\n` })
          wake()
        }
        return
      }
      if (type === 'turn.completed') {
        queue.push({
          type: 'done',
          usage: payload.usage ?? null,
          // 无 text 流时的最终回复兜底
          response: typeof payload.response === 'string' && payload.response !== '' ? payload.response : undefined,
          route: routeInfo,
        })
        finished = true
        wake()
        return
      }
      if (type === 'turn.failed') {
        failure = new Error(String(payload?.error?.message ?? payload?.message ?? 'ZCode 回合失败'))
        // B13：把生效路由挂到失败上，供 stream() 标记通道黑名单
        if (routeInfo) {
          failure.routeProviderId = routeInfo.providerId
          failure.routeModelId = routeInfo.modelId
        }
        finished = true
        wake()
      }
    })
    cleanups.push(off)
    // 进程死亡不再等预算超时：立即落地失败（配合 gateway/看门狗，socket 不悬挂）
    const offExit = typeof client.onExit === 'function' ? client.onExit(() => {
      if (!finished) {
        failure = new Error('ZCode app-server 进程退出，回合中止')
        if (routeInfo) failure.routeProviderId = routeInfo.providerId
        finished = true
        wake()
      }
    }) : null
    if (typeof offExit === 'function') cleanups.push(offExit)

    try {
      await subscribe(client, session.sessionId)
      const current = session.raw?.current ?? session.raw?.selected ?? null

      // 设计决策（2026-11-21，操作者确认）：明确选择的模型绝不静默替换。
      // 额度/套餐不可用 → 直接明确报错，由 stream() 聚合为「无可用额度」；
      // 仅保留账号级 failover（同模型换号）。原 A5 双向平替已按决策移除。
      const activeModelId = modelId

      // B6/B13：start-plan 优先；其次任意**未拉黑**通道（保留合法 coding-plan 订阅户）；
      // 候选全被拉黑 → 明确报错，不再逐账号试错风暴。
      const sessionModels = Array.isArray(session.models) ? session.models : []
      const req = String(activeModelId).toLowerCase()
      const modelMatch = (/** @type {any} */ m) => {
        const mid = String(m.ref?.modelId ?? m.modelId ?? m.id ?? '').toLowerCase()
        const lbl = String(m.label ?? '').toLowerCase()
        return mid === req || lbl === req
      }
      const notBlacklisted = (/** @type {any} */ m) => !this.pool.isChannelBlacklisted?.(entry.id, String(m.ref?.providerId ?? ''))
      const matched =
        sessionModels.find((m) => String(m.ref?.providerId ?? '').includes('start-plan') && modelMatch(m) && notBlacklisted(m))
        ?? sessionModels.find((m) => modelMatch(m) && notBlacklisted(m))
      if (!matched) {
        const blocked = sessionModels.find((m) => modelMatch(m))
        if (blocked) {
          const e = new Error(`账号「${entry.label}」的 ${activeModelId} 通道近期持续失败（多为额度耗尽或套餐过期），本轮已临时跳过`)
          e.code = 'CHANNEL_UNAVAILABLE'
          throw e
        }
      }

      // 确定 reasoning 级别（用户在 DSH UI 选择的思考等级优先，模型默认次之，最后根据模型实际支持 levels 智能兜底）
      const effectiveReasoning = resolveModelReasoningLevel(matched, reasoningEffort) ||
        this.modelIndex.get(activeModelId)?.reasoningLevel ||
        matched?.reasoning?.defaultLevel ||
        'max'

      let target
      if (matched && matched.ref?.providerId) {
        target = {
          providerId: String(matched.ref.providerId),
          modelId: String(matched.ref.modelId),
          reasoningLevel: effectiveReasoning,
        }
      } else {
        const cached = this.modelIndex.get(activeModelId)
        target = {
          providerId: cached?.providerId || current?.providerId || '',
          modelId: cached?.modelId || activeModelId,
          reasoningLevel: effectiveReasoning,
        }
      }
      routeInfo = { providerId: target.providerId, modelId: target.modelId, reasoningLevel: target.reasoningLevel }

      // 如果当前会话的模型或思考等级与目标不一致，执行 setModel 切换
      const currentReasoning = current?.options?.reasoningLevel || current?.reasoningLevel
      const needsSwitch = current === null ||
        current.providerId !== target.providerId ||
        current.modelId !== target.modelId ||
        (target.reasoningLevel && currentReasoning !== target.reasoningLevel)

      if (needsSwitch && target.providerId !== '' && target.modelId !== '') {
        try {
          await setModel(client, session.sessionId, target)
        } catch (setErr) {
          this.logger.warn?.(`[dx-zcode] setModel (${target.providerId}/${target.modelId}) 首次切换重试中：${setErr instanceof Error ? setErr.message : String(setErr)}`)
          try {
            await setModel(client, session.sessionId, target)
          } catch (retryErr) {
            const err = new Error(`ZCode 模型切换失败 (${target.providerId}/${target.modelId})：${retryErr instanceof Error ? retryErr.message : String(retryErr)}`)
            err.routeProviderId = target.providerId
            throw err
          }
        }
      }

      options?.signal?.throwIfAborted?.()
      try {
        await send(client, session.sessionId, prompt)
      } catch (sendErr) {
        // B13：send 层错误同样挂载路由，供通道标记
        if (sendErr instanceof Error && target.providerId) sendErr.routeProviderId = target.providerId
        throw sendErr
      }

      const deadline = Date.now() + totalBudgetMs
      let sawText = false
      let currentBlockIndex = 0
      let reasoningBlockIndex = -1
      let textBlockIndex = -1

      while (!finished || queue.length > 0) {
        if (queue.length === 0) {
          const now = Date.now()
          if (options?.signal?.aborted) {
            const e = new Error('回合已被用户中止')
            e.name = 'AbortError'
            throw e
          }
          if (now > deadline) {
            const e = new Error(hangFast ? `ZCode 回合挂起（收缩预算 ${Math.round(totalBudgetMs / 1000)}s 内无响应）` : 'ZCode 回合超时')
            e.firstTokenSeen = firstTokenSeen
            throw e
          }
          // B10：两级看门狗——首事件超时 / 流中停摆，消灭 600s 静默挂死
          const budget = firstTokenSeen ? idleMs : firstTokenMs
          if (now - lastEventAt > budget) {
            const e = new Error(firstTokenSeen
              ? `ZCode 事件停摆超过 ${Math.round(idleMs / 1000)}s，判定挂起`
              : `ZCode ${Math.round(firstTokenMs / 1000)}s 内无任何流事件，判定挂起`)
            e.firstTokenSeen = firstTokenSeen
            throw e
          }
          await new Promise((resolve) => {
            notify = resolve
            setTimeout(resolve, 1000)
          })
          continue
        }
        const item = queue.shift()
        if (item.type === 'reasoning') {
          if (reasoningBlockIndex === -1) {
            reasoningBlockIndex = currentBlockIndex++
          }
          yield { type: 'reasoning-delta', index: reasoningBlockIndex, text: item.text }
        } else if (item.type === 'text') {
          sawText = true
          if (textBlockIndex === -1) {
            textBlockIndex = currentBlockIndex++
          }
          yield { type: 'text-delta', index: textBlockIndex, text: item.text }
        } else if (item.type === 'done') {
          // 无 text 流时用最终 response 兜底，保证 DSH 侧拿到非空正文
          if (!sawText && typeof item.response === 'string' && item.response !== '') {
            sawText = true
            if (textBlockIndex === -1) {
              textBlockIndex = currentBlockIndex++
            }
            yield { type: 'text-delta', index: textBlockIndex, text: item.response }
          }
          if (item.usage) {
            const raw = item.usage
            const rawInput = Number(raw.input_tokens ?? raw.prompt_tokens ?? raw.inputTokens ?? raw.input ?? 0)
            const outputTokens = Number(raw.output_tokens ?? raw.completion_tokens ?? raw.outputTokens ?? raw.output ?? 0)
            const cacheReadTokens = Number(raw.cacheReadTokens ?? raw.cache_read_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? raw.cachedTokens ?? raw.cache_tokens ?? raw.cacheRead ?? 0)
            const cacheWriteTokens = Number(raw.cacheWriteTokens ?? raw.cache_write_tokens ?? raw.prompt_tokens_details?.cache_creation_tokens ?? raw.cacheCreationTokens ?? raw.cacheWrite ?? 0)
            // DSH 规范（与 codearts / dsh-xdpool 统一）：
            // DSH 的 token-meter 将 usage.inputTokens 视为【未命中缓存的输入 Token】（uncachedInputTokens）；
            // DSH 会将 inputTokens + cacheReadTokens 作为总输入计算 contextPressure 与缓存命中率。
            // 若 rawInput 已包含 cacheReadTokens，必须扣减缓存命中部分，否则会导致上下文 double-count 膨胀并使缓存命中率腰斩！
            const inputTokens = cacheReadTokens > 0 && rawInput >= cacheReadTokens
              ? rawInput - cacheReadTokens
              : rawInput
            const totalTokens = Number(raw.total_tokens ?? raw.totalTokens ?? raw.total ?? (rawInput + outputTokens))
            yield {
              type: 'usage',
              usage: {
                inputTokens,
                outputTokens,
                totalTokens,
                cacheReadTokens,
                cacheWriteTokens,
              },
              // B14：实际生效路由回传给 stream() 记账
              route: item.route ?? null,
            }
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }
      if (failure !== null) throw failure
    } finally {
      for (const fn of cleanups) {
        try {
          fn()
        } catch {
          /* 清理失败不影响主流程。 */
        }
      }
      if (session?.sessionId) {
        void closeSession(client, session.sessionId).catch(() => {})
      }
    }
  }
}

/**
 * 提取直连请求的调用方 system 文本（options.system 优先，其次前导 system 消息）。
 * @param {any} options
 * @returns {string | undefined}
 */
function systemTextOf(options) {
  if (typeof options?.system === 'string' && options.system.trim() !== '') return options.system
  /** @type {string[]} */
  const parts = []
  for (const m of Array.isArray(options?.messages) ? options.messages : []) {
    if (String(m?.role) !== 'system') continue
    const t = typeof m.content === 'string'
      ? m.content
      : (Array.isArray(m.content)
        ? m.content.map((p) => (p?.type === 'text' && typeof p.text === 'string' ? p.text : '')).filter((s) => s !== '').join('\n')
        : '')
    if (t.trim() !== '') parts.push(t)
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

/**
 * 智能解析当前会话的工作区物理绝对路径，确保 ZCode 客户端读写真实的项目工作区而非 DSH 启动目录。
 * @param {string} sessionId
 * @returns {string}
 */
export function resolveWorkspacePath(sessionId) {
  if (!sessionId) return process.cwd()
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''

  // 1. 优先从 session_projcache 快速读取
  try {
    const projPath = path.join(home, '.dsh', 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
    if (fs.existsSync(projPath)) {
      const data = JSON.parse(fs.readFileSync(projPath, 'utf8'))
      const cwd = data?.record?.rows?.workingDirectory?.val || data?.record?.identity?.cwd
      if (typeof cwd === 'string' && cwd.trim() !== '') return cwd.trim()
    }
  } catch {}

  // 2. 从 workspace.json 反查
  try {
    const wsPath = path.join(home, '.dsh', 'storages', 'workspace.json')
    if (fs.existsSync(wsPath)) {
      const data = JSON.parse(fs.readFileSync(wsPath, 'utf8'))
      const workspaces = data?.tables?.workspaces ?? {}
      for (const wid of Object.keys(workspaces)) {
        const ws = workspaces[wid]
        if (Array.isArray(ws?.sessionIds) && ws.sessionIds.includes(sessionId)) {
          if (typeof ws.path === 'string' && ws.path.trim() !== '') return ws.path.trim()
        }
      }
    }
  } catch {}

  return process.cwd()
}

/**
 * 提取对话会话唯一标识，实现会话亲和性（同一对话固定使用同一个账号，避免每轮换号）。
 * @param {any} options
 * @returns {string}
 */
export function sessionKeyOf(options) {
  if (!options || typeof options !== 'object') return ''
  if (typeof options.conversationId === 'string' && options.conversationId.trim() !== '') {
    return options.conversationId.trim()
  }
  if (typeof options.sessionId === 'string' && options.sessionId.trim() !== '') {
    return options.sessionId.trim()
  }
  if (typeof options.chatId === 'string' && options.chatId.trim() !== '') {
    return options.chatId.trim()
  }
  if (typeof options.id === 'string' && options.id.trim() !== '') {
    return options.id.trim()
  }
  // 从消息列表中提取首条消息特征（同一会话中第一条用户消息的内容与签名恒定）
  const messages = Array.isArray(options.messages) ? options.messages : []
  if (messages.length > 0) {
    const first = messages[0]
    if (first) {
      if (typeof first.id === 'string' && first.id !== '') {
        return `msg-${first.id}`
      }
      const text = typeof first.content === 'string'
        ? first.content
        : (Array.isArray(first.content) ? JSON.stringify(first.content) : '')
      if (text !== '') {
        const hash = createHash('sha256').update(`${first.role || 'user'}:${text.slice(0, 200)}`).digest('hex').slice(0, 16)
        return `conv-${hash}`
      }
    }
  }
  return ''
}

/**
 * 从 DSH 请求里取出纯文本 prompt。
 * @param {any} options
 * @returns {string}
 */
function promptOf(options) {
  const messages = Array.isArray(options?.messages) ? options.messages : []
  /** @type {string[]} */
  const blocks = []
  // B4：user 消息一律带 [user] 前缀——多轮间前缀恒定，上游前缀缓存从
  // 第 2 轮起稳定命中（旧实现在出现 assistant 消息后前缀分歧，缓存击穿）。
  for (const m of messages) {
    const role = String(m?.role ?? 'user')
    const text = partsToText(m?.content)
    if (text === '') continue
    if (role === 'assistant') blocks.push(`[assistant]\n${text}`)
    else if (role === 'system') blocks.push(`[system]\n${text}`)
    else blocks.push(`[user]\n${text}`)
  }
  if (blocks.length === 0 && typeof options?.prompt === 'string') return options.prompt
  return blocks.join('\n\n')
}

/** @param {any} content @returns {string} */
function partsToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((p) => (typeof p === 'string' ? p : p?.type === 'text' && typeof p.text === 'string' ? p.text : ''))
    .filter((s) => s !== '')
    .join('\n')
}

// ── apply ─────────────────────────────────────────────────────────────────────

/**
 * @param {any} ctx Cordis 上下文
 * @param {any} config 原始配置
 * @returns {void}
 */
export function apply(ctx, config) {
  const logger = ctx.logger ?? console

  // 受管凭据密钥：登录走 CLI env 模式写入本文件加密的凭据；本进程解密与
  // app-server 子进程都靠它。影子根有自己的 per-root 密钥（解密候选链按
  // 指纹匹配挑选，见 credentials.js decryptValue）。
  try {
    process.env.ZCODE_CREDENTIAL_SECRET_FILE = ensureManagedSecret()
  } catch (error) {
    logger.warn?.(`[dx-zcode] 受管密钥初始化失败：${error instanceof Error ? error.message : String(error)}`)
  }

  let current = () => config
  /** @type {any} */
  let lastRaw
  /** @type {ResolvedOptions | undefined} */
  let lastGood
  /** @returns {ResolvedOptions} */
  const options = () => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveOptions(raw)
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      if (lastGood === undefined) throw error
      logger.error?.('[dx-zcode] 配置不合法，沿用上一份可用配置')
      lastRaw = raw
      return lastGood
    }
  }
  options()

  const initial = options()
  const pool = new AccountPool({ options, logger })
  const callLog = new CallLog()
  const adapter = new ZcodeWelfareAdapter({ pool, options, logger, callLog })

  // 验证码提供者：CLI 会在每次模型请求前通过
  // interaction/requestProviderRuntimeHeaders 向宿主索要它。
  /** @type {() => { param: string, region: string } | null} */
  const captchaProvider = () => cachedCaptcha()

  // 账号池里的客户端需要拿到这个提供者，才能把验证码注入模型请求。
  pool.captchaProvider = captchaProvider
  pool.captchaSolver = (opts = {}) => solveCaptcha({ logger, ...opts })
  pool.captchaSessionFactory = () => createCaptchaSession(logger)

  const gateway = new Gateway({
    port: initial.gatewayPort,
    host: initial.gatewayHost,
    authToken: initial.gatewayAuthToken,
    logger,
    callLog,
    listModels: () => pool.getZcodeModels(),
    resolveRoute: (requestedModel, sessionId = '', excludeIds = new Set()) => {
      const entry = pool.pick(sessionId, excludeIds)
      if (entry === null) return null
      const zcodeModels = pool.getZcodeModels()
      if (zcodeModels.length === 0) return null
      const enabledModels = zcodeModels.filter((m) => m.enabled !== false)
      if (enabledModels.length === 0) return null

      const defaultId = pool.getDefaultModel()
      const explicit = Boolean(requestedModel && requestedModel !== 'default' && requestedModel !== 'auto')
      const req = explicit ? String(requestedModel).trim() : defaultId

      // 设计决策（2026-11-21）：显式指定的模型必须精确匹配，不存在/已停用 →
      // 明确失败（网关 503），绝不静默替换；仅 default/auto 才回退到首个启用模型
      let matched = enabledModels.find((m) =>
        m.id.toLowerCase() === req.toLowerCase() ||
        (m.label && m.label.toLowerCase() === req.toLowerCase())
      )
      if (!matched) {
        if (explicit) return null
        matched = enabledModels[0]
      }

      return {
        client: pool.clientFor(entry),
        account: entry.account,
        accountId: entry.id,
        accountLabel: entry.label,
        model: {
          providerId: String(matched.providerId),
          modelId: String(matched.id || matched.modelId),
          reasoningLevel: matched.reasoning?.defaultLevel || undefined,
        },
      }
    },
  })

  // 首次加载账号池：延迟到 UI 资源加载完之后，影子目录复制与凭据解密
  // 不与主界面抢磁盘与事件循环（登录流程里仍会立即加载）。
  // 加载完成后 D3 预热主账号的 app-server（后台、unref、失败不影响主流程）。
  const bootLoadTimer = setTimeout(() => {
    pool.load()
      .then(() => { pool.preheat() })
      .catch((error) => {
        logger.warn?.(`[dx-zcode] 账号池加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
  }, 2500)
  if (typeof bootLoadTimer.unref === 'function') bootLoadTimer.unref()
  ctx.effect(() => () => clearTimeout(bootLoadTimer), 'dx-zcode: 延迟加载账号池')

  // 面板后端路由与调用记录
  registerApiRoute(ctx, {
    pool,
    gateway,
    callLog,
    options,
    logger,
    pluginVersion: PLUGIN_VERSION,
    environment: () => environmentFacts(initial),
    login: async (provider) => {
      const opts = options()
      let cli = null
      try {
        cli = locateCli(opts.zcodeCliPath)
      } catch (error) {
        throw error
      }
      const result = await loginWithCli({
        cliPath: cli.path,
        dataBaseDir: pool.list()[0]?.sourceRoot ?? resolveDataBaseDir(opts.zcodeDataBaseDir),
        provider,
        logger,
      })
      // 登录后重建账号池，让新账号立刻可用。
      await pool.load().catch(() => {})
      await pool.refreshAll(true).catch(() => {})
      return result
    },
  })

  ctx.effect(() => () => {
    pool.dispose()
    gateway.stop().catch(() => {})
  }, 'dx-zcode: 账号池与网关')

  if (initial.enabled) {
    try {
      const canonical = initial.providerId || 'dx-zcode'
      // 仅向可配置 Provider 目录注册单一主渠道，彻底避免在 DSH 对话框中生成多个重复渠道
      const providersToRegister = [
        {
          provider: canonical,
          displayName: 'DX Zcode',
          settingsNs: name,
          settingsPath: [],
        },
      ]
      ctx.llm.registerConfigurableProviders(providersToRegister)
      // 适配器同时挂载别名，保证历史会话与别名调用平滑兼容
      const adapterIds = Array.from(new Set([canonical, 'dx-zcode', 'dxzcode', 'zcode-cli']))
      ctx.llm.registerAdapter(adapterIds, adapter)
      logger.info?.(`[dx-zcode] providers [${adapterIds.join(', ')}] 已注册 (UI主渠道: ${canonical})`)
    } catch (error) {
      logger.error?.(`[dx-zcode] provider 注册失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 网关按需启动
  if (initial.gatewayEnabled) {
    gateway.start().catch((error) => {
      logger.error?.(`[dx-zcode] 网关启动失败：${error instanceof Error ? error.message : String(error)}`)
    })
  }

  // 自动领取
  if (initial.autoClaimMinutes > 0) {
    const timer = setInterval(() => {
      pool.claimAll({})
        .then((r) => {
          const done = r.flatMap((x) => x.claimed)
          if (done.length > 0) logger.info?.(`[dx-zcode] 自动领取：${done.join('；')}`)
        })
        .catch(() => {})
    }, initial.autoClaimMinutes * 60_000)
    if (typeof timer.unref === 'function') timer.unref()
    ctx.effect(() => () => clearInterval(timer), 'dx-zcode: 自动领取')
  }

  logger.info?.('[dx-zcode] 已加载')
}

export { AccountPool, Gateway, ZcodeWelfareAdapter }
export default { name, inject, Config, apply }
