/**
 * 面板后端 API。
 *
 * 安全约定（与 dsh-purge-community 的 allowPluginRequest 同一契约）：
 *   - 连接层认证由宿主 connection 在路由上游完成，这里只做同源栅栏
 *     （cross-site / origin:null / origin≠Host 一律拒绝）
 *   - 不向浏览器返回任何 token；账号只暴露 id / 标签 / 站点 / 额度
 *   - 不接受任意文件路径或命令参数
 *
 * 路由：POST /dx-zcode/api（根命名空间，与 /dsh-purge/* 同一约定）
 * 注册契约：webServer.register({ kind: 'exact', path, handler })，返回 disposer
 * 请求体：{ action, ... }
 */

export const API_PATH = '/dx-zcode/api'

/** 面板可发起的操作白名单。 */
const ACTIONS = new Set([
  'state',
  'refresh',
  'probe-one',
  'clear-ineligible',
  'claim',
  'claim-start',
  'claim-status',
  'claim-dismiss',
  'login',
  'enable',
  'disable',
  'gateway-start',
  'gateway-stop',
  'logs-clear',
  'logs-clear-failed',
  'set-default-model',
  'set-model-enabled',
  'set-channel-mode',
  'remove-account',
  'restore-desktop',
])

/** @type {{ id: string, status: 'idle' | 'running' | 'done' | 'error', current: number, total: number, stepText: string, reuseBrowser: boolean, startedAt: number, finishedAt: number, report: any }} */
const claimJob = {
  id: '',
  status: 'idle',
  current: 0,
  total: 0,
  stepText: '',
  reuseBrowser: false,
  startedAt: 0,
  finishedAt: 0,
  report: null,
}

function resetClaimJob() {
  claimJob.id = ''
  claimJob.status = 'idle'
  claimJob.current = 0
  claimJob.total = 0
  claimJob.stepText = ''
  claimJob.reuseBrowser = false
  claimJob.startedAt = 0
  claimJob.finishedAt = 0
  claimJob.report = null
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {any} value */
function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any | null>}
 */
function readJson(req) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
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

/**
 * 同源栅栏：cross-site 与 origin:null 拒绝；带 origin 时必须与 Host 匹配。
 * 连接层认证由宿主在路由上游完成，这里不再重复校验。
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
function csrfAllowed(req) {
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
  if (site === 'cross-site') return false
  const origin = String(req.headers['origin'] ?? '').trim()
  if (origin === '') return true
  if (origin === 'null') return false
  try {
    const originHost = new URL(origin).host.toLowerCase()
    const host = String(req.headers['host'] ?? '').trim().toLowerCase()
    return host !== '' && originHost === host
  } catch {
    return false
  }
}

/**
 * 注册 API 路由。
 *
 * @param {any} ctx Cordis 上下文
 * @param {{ pool: any, gateway: any, callLog: any, options: () => any, pluginVersion: string, login: (provider: string) => Promise<any>, environment: () => any, logger?: any }} deps
 * @returns {void}
 */
export function registerApiRoute(ctx, deps) {
  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  const handler = async (req, res) => {
    res.setHeader('cache-control', 'no-store')
    if (!csrfAllowed(req)) {
      json(res, 403, { error: 'forbidden' })
      return
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    const body = await readJson(req)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      json(res, 400, { error: 'invalid body' })
      return
    }
    const action = String(body.action ?? '')
    if (!ACTIONS.has(action)) {
      json(res, 400, { error: `unknown action: ${action}` })
      return
    }

    try {
      const payload = await run(action, body, { ...deps, ctx })
      json(res, 200, payload)
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  // 宿主 webServer 路由：register 契约是路由对象 {kind, path, handler}，
  // 返回 disposer（不清理会在热重载时撞 duplicate route）。此前误用
  // register(path, handler) 位置参数，注册成了 path=undefined 的幽灵路由。
  try {
    ctx.inject(['webServer'], (/** @type {any} */ hostCtx) => {
      try {
        const dispose = hostCtx.webServer.register({ kind: 'exact', path: API_PATH, handler })
        if (typeof dispose === 'function') {
          ctx.effect(() => () => dispose(), 'dx-zcode: API 路由')
        }
      } catch (error) {
        const logger = deps.logger ?? ctx.logger ?? console
        logger.warn?.(`[dx-zcode] API 路由注册失败：${error instanceof Error ? error.message : String(error)}`)
      }
    })
  } catch {
    /* 没有 webServer 时面板不可用，但 provider 仍工作。 */
  }
}

/**
 * @param {string} action
 * @param {any} body
 * @param {any} deps
 * @returns {Promise<any>}
 */
async function run(action, body, deps) {
  const { pool, gateway, callLog, options, pluginVersion, login, environment } = deps

  if (action === 'state' || action === 'refresh' || action === 'probe-one' || action === 'clear-ineligible'
      || action === 'claim-dismiss' || action === 'logs-clear' || action === 'logs-clear-failed' || action === 'enable'
      || action === 'disable' || action === 'gateway-start' || action === 'gateway-stop' || action === 'remove-account'
      || action === 'restore-desktop') {
    if (action === 'state') await pool.refreshAll(false).catch(() => {})
    if (action === 'refresh') await pool.refreshAll(true).catch(() => {})
    if (action === 'probe-one') {
      const id = String(body.id ?? '').trim()
      if (!id) throw new Error('缺少账号 id')
      await pool.refreshOne(id)
    }
    if (action === 'clear-ineligible') {
      const id = String(body.id ?? '').trim()
      if (!id) throw new Error('缺少账号 id')
      await pool.clearIneligible?.(id)
    }
    if (action === 'claim-dismiss') {
      if (claimJob.status !== 'running') resetClaimJob()
    }
    if (action === 'restore-desktop') await pool.restoreDesktopAccount?.()
    if (action === 'remove-account') {
      const id = String(body.id ?? '').trim()
      if (!id) throw new Error('缺少账号 id')
      await pool.removeAccount(id)
    }
    if (action === 'logs-clear') callLog.clear()
    if (action === 'logs-clear-failed') callLog.clearFailed?.()
    if (action === 'enable' || action === 'disable') {
      const id = String(body.id ?? '')
      if (id === '') throw new Error('缺少账号 id')
      const ok = pool.update(id, { enabled: action === 'enable' })
      if (!ok) throw new Error(`账号不存在：${id}`)
    }
    if (action === 'gateway-start') {
      const opts = options()
      gateway.options.port = opts.gatewayPort
      gateway.options.host = opts.gatewayHost
      gateway.options.authToken = opts.gatewayAuthToken
      await gateway.start()
    }
    if (action === 'gateway-stop') await gateway.stop()
    return state(deps)
  }

  if (action === 'claim-status') {
    if (claimJob.status === 'running') {
      return { claimJob: { ...claimJob } }
    }
    return state(deps)
  }

  if (action === 'claim-start') {
    const only = Array.isArray(body.only) ? body.only : (body.id ? [String(body.id)] : undefined)
    if (claimJob.status !== 'running') {
      claimJob.id = `job-${Date.now()}`
      claimJob.status = 'running'
      claimJob.current = 0
      claimJob.total = 0
      claimJob.stepText = '正在并发探测待领福利包与模型资格…'
      claimJob.reuseBrowser = Boolean(pool.captchaSessionFactory)
      claimJob.startedAt = Date.now()
      claimJob.finishedAt = 0
      claimJob.report = null

      void pool.claimAll({
        only,
        onProgress: (info) => {
          if (claimJob.status !== 'running') return
          if (typeof info.current === 'number') claimJob.current = info.current
          if (typeof info.total === 'number') claimJob.total = info.total
          if (typeof info.reuseBrowser === 'boolean') claimJob.reuseBrowser = info.reuseBrowser
          if (info.stepText) claimJob.stepText = String(info.stepText)
        },
      }).then((result) => {
        const claimed = []
        const skipped = []
        const failed = []
        for (const r of Array.isArray(result) ? result : []) {
          const acc = r.label || r.id || '账号'
          for (const line of r.claimed ?? []) claimed.push({ account: acc, detail: line })
          for (const line of r.skipped ?? []) skipped.push({ account: acc, reason: line })
          for (const f of r.failed ?? []) failed.push({ account: acc, error: f?.error || '领取失败' })
          if (r.error) failed.push({ account: acc, error: r.error })
        }
        claimJob.status = 'done'
        claimJob.finishedAt = Date.now()
        claimJob.stepText = `完成：成功 ${claimed.length} · 跳过 ${skipped.length} · 失败 ${failed.length}`
        claimJob.report = { claimed, skipped, failed }
      }).catch((err) => {
        claimJob.status = 'error'
        claimJob.finishedAt = Date.now()
        const msg = err instanceof Error ? err.message : String(err)
        claimJob.stepText = `领取出错：${msg}`
        claimJob.report = { claimed: [], skipped: [], failed: [{ account: '系统', error: msg }] }
      })
    }
    return state(deps)
  }

  if (action === 'claim') {
    const only = Array.isArray(body.only) ? body.only : (body.id ? [String(body.id)] : undefined)
    const result = await pool.claimAll({ only })
    const merged = {
      claimed: result.flatMap((/** @type {any} */ r) => (r.claimed ?? []).map((/** @type {string} */ line) => `${r.label}: ${line}`)),
      failed: result.flatMap((/** @type {any} */ r) => [
        ...(r.failed ?? []),
        ...(r.error ? [{ planId: '*', error: `${r.label}: ${r.error}` }] : []),
      ]),
      skipped: result.flatMap((/** @type {any} */ r) => r.skipped ?? []),
    }
    const s = await state(deps)
    return { ...s, claim: merged }
  }

  if (action === 'login') {
    const provider = String(body.provider ?? '')
    if (provider !== 'zai_cn' && provider !== 'zai' && provider !== 'bigmodel') {
      throw new Error('登录站点必须是 zai_cn / zai / bigmodel')
    }
    const result = await login(provider)
    const s = await state(deps)
    return { ...s, login: result }
  }

  if (action === 'set-channel-mode') {
    // 手动二选一切换模型通道（cli / direct），选择哪个就用哪个，不做自动回退
    const mode = body.mode === 'direct' ? 'direct' : 'cli'
    pool.setChannelMode?.(mode)
    return state(deps)
  }

  if (action === 'set-default-model') {
    const modelId = String(body.modelId ?? '').trim()
    if (!modelId) throw new Error('缺少 modelId')
    pool.setDefaultModel?.(modelId)
    pool.setModelEnabled?.(modelId, true)
    try {
      deps.ctx?.emit?.('llm/adapters-updated')
    } catch {}
    return state(deps)
  }

  if (action === 'set-model-enabled') {
    const modelId = String(body.modelId ?? '').trim()
    const enabled = Boolean(body.enabled)
    if (!modelId) throw new Error('缺少 modelId')
    pool.setModelEnabled?.(modelId, enabled)
    try {
      deps.ctx?.emit?.('llm/adapters-updated')
    } catch {}
    return state(deps)
  }

  throw new Error(`未实现的操作：${action}`)
}

/**
 * @param {any} deps
 * @returns {Promise<any>}
 */
async function state(deps) {
  const { pool, gateway, callLog, options, pluginVersion, environment } = deps
  const opts = options()
  // environment 是函数（惰性取环境事实）—— 此前漏了调用，cli 恒为 null
  const facts = typeof environment === 'function' ? environment() : (environment ?? {})
  const defaultModel = pool.getDefaultModel ? pool.getDefaultModel() : 'GLM-5.3-Flash'
  const models = pool.getZcodeModels ? pool.getZcodeModels() : (pool.getCachedModels ? pool.getCachedModels() : [])
  return {
    version: pluginVersion,
    busy: false,
    channelMode: pool.getChannelMode ? pool.getChannelMode(opts) : 'cli',
    cli: facts.cli ?? null,
    accounts: pool.view(),
    models: Array.isArray(models) ? models : [],
    defaultModel,
    // A3：不再把 gatewayAuthToken 明文回传浏览器——只暴露是否已配置
    gateway: { ...gateway.status(), port: opts.gatewayPort, host: opts.gatewayHost, defaultModel, authRequired: Boolean(opts.gatewayAuthToken) },
    logs: callLog.view(50),
    stats: callLog.stats(),
    claimJob: { ...claimJob },
  }
}
