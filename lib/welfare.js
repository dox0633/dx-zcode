/**
 * ZCode 福利（活动套餐）探测与领取。
 *
 * 事实依据（本机实测 2026-11-18，ZCode 3.18.2）：
 *
 *   1. `GET  /api/v1/marketing/touch`  ← 活动卡片的**唯一**来源
 *      返回 `data.deliveries[]`，每项描述一个可领/已领活动。
 *      `billing/preview` 对活动卡片恒返回空 data，不能当唯一依据。
 *
 *   2. `GET  /api/v1/zcode-plan/billing/balance?app_version=<v>`
 *      返回 `data.plans[]`（已领取的套餐，含 entitlements 与 effective_at）
 *      与 `data.balances[]`（已生效的额度桶）。
 *
 *   3. `POST /api/v1/zcode-plan/billing/claim?app_version=<v>`
 *      必须带 `X-Aliyun-Captcha-Verify-Param`，否则 400 / 3007
 *      `captcha verify failed`。
 *
 * 关于「已领取」的判定：`effective_at` 之前的权益已经在 plans 里存在，
 * 只是 balances 为空。因此「待生效额度」= plans[].entitlements[] 中
 * effective_at > now 的部分，这与是否还需要领取无关。
 */

import { jwtPayload } from './credentials.js'

const HOST = 'https://zcode.z.ai'
/** 服务端对部分新活动（如 2026-11-27 3 亿礼包）强制校验客户端版本 >= 4.0.0。 */
export const MIN_API_APP_VERSION = '4.0.0'

/**
 * 规范化接口请求使用的客户端版本号：若低于最低要求（如旧版 CLI 3.18.2-47）则提升至 4.0.0。
 * @param {string} [appVersion]
 * @returns {string}
 */
export function resolveApiAppVersion(appVersion) {
  const raw = String(appVersion ?? '').trim()
  if (!raw || raw === 'unknown' || raw === '0.0.0') return MIN_API_APP_VERSION
  const parse = (v) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0)
  const cur = parse(raw)
  const min = parse(MIN_API_APP_VERSION)
  for (let i = 0; i < 3; i++) {
    if ((cur[i] ?? 0) > (min[i] ?? 0)) return raw
    if ((cur[i] ?? 0) < (min[i] ?? 0)) return MIN_API_APP_VERSION
  }
  return raw
}

/** @param {string} code @param {string} message @param {any} [detail] @param {number} [status] */
function zerr(code, message, detail, status) {
  const e = /** @type {Error & { code: string, detail?: any, status?: number }} */ (new Error(message))
  e.code = code
  if (detail !== undefined) e.detail = detail
  if (status !== undefined) e.status = status
  return e
}

/**
 * 构造上游请求头。
 *
 * 这里刻意**不**伪造 CLI 的 system envelope —— 只做 ZCode 自身的 API 调用
 * （billing / marketing），这类端点只校验 plan JWT 与 device-mid，
 * 不经过模型通道的 3012 客户端闸门。
 * @param {import('./credentials.js').ZcodeAccount} account
 * @param {string} appVersion
 * @returns {Record<string, string>}
 */
export function apiHeaders(account, appVersion) {
  const version = resolveApiAppVersion(appVersion)
  return {
    accept: '*/*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    authorization: `Bearer ${account.planToken}`,
    'content-type': 'application/json',
    'user-agent': `ZCode/${version} ai-sdk/provider-utils/4.0.27 runtime/node.js/24`,
    'HTTP-Referer': 'https://zcode.z.ai',
    'X-ZCode-App-Version': version,
    'X-Release-Channel': 'stable',
    'X-Device-Mid': account.deviceMid,
    'X-Client-Language': 'zh-CN',
    'X-Client-Timezone': 'Asia/Shanghai',
    'X-Platform': 'win32-x64',
    'X-Os-Category': 'windows',
    'X-Title': 'Z Code',
  }
}

/** @param {number} ms @returns {Promise<void>} */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** @param {string} label @param {string} url @param {RequestInit} init @returns {Promise<any>} */
async function requestJson(label, url, init) {
  const maxRetries = 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response
    try {
      response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) })
    } catch (cause) {
      if (attempt < maxRetries) {
        await sleep(600 * (attempt + 1))
        continue
      }
      throw zerr('NETWORK', `${label} 请求失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfterSec = Number(response.headers?.get?.('retry-after') ?? 0)
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(retryAfterSec * 1000, 5000)
        : 800 * (attempt + 1)
      await sleep(waitMs)
      continue
    }
    const text = await response.text()
    let payload
    try {
      payload = text === '' ? {} : JSON.parse(text)
    } catch {
      throw zerr('UPSTREAM_FORMAT', `${label} 返回了非 JSON 内容（HTTP ${response.status}）：${text.slice(0, 200)}`, undefined, response.status)
    }
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      throw zerr('UPSTREAM', `${label} 失败：HTTP ${response.status} code=${payload.code ?? '-'} ${payload.msg ?? payload.message ?? ''}`.trim(), payload, response.status)
    }
    return payload
  }
}

// ── 探测 ──────────────────────────────────────────────────────────────────────

/**
 * 读取活动卡片（marketing/touch）。
 * @param {import('./credentials.js').ZcodeAccount} account
 * @param {string} appVersion
 * @returns {Promise<{ deliveries: any[], serverTime: number, language: string }>}
 */
export async function fetchMarketing(account, appVersion) {
  const version = resolveApiAppVersion(appVersion)
  const url = `${HOST}/api/v1/marketing/touch?seq=1`
  const payload = await requestJson('活动探测', url, { method: 'GET', headers: apiHeaders(account, version) })
  const data = payload.data ?? {}
  return {
    deliveries: Array.isArray(data.deliveries) ? data.deliveries : [],
    serverTime: Number(data.server_time ?? 0) || Math.floor(Date.now() / 1000),
    language: String(data.language ?? ''),
  }
}

/**
 * 读取可手动领取的套餐预览（billing/preview）。
 * @param {import('./credentials.js').ZcodeAccount} account
 * @param {string} appVersion
 * @returns {Promise<{ plans: any[], serverTime: number }>}
 */
export async function fetchPreview(account, appVersion) {
  const version = resolveApiAppVersion(appVersion)
  const url = `${HOST}/api/v1/zcode-plan/billing/preview?app_version=${encodeURIComponent(version)}&platform=win32`
  try {
    const payload = await requestJson('套餐预览', url, { method: 'GET', headers: apiHeaders(account, version) })
    const data = payload.data ?? {}
    return {
      plans: Array.isArray(data.plans) ? data.plans : [],
      serverTime: Number(data.server_time ?? 0) || Math.floor(Date.now() / 1000),
    }
  } catch {
    return { plans: [], serverTime: 0 }
  }
}

/**
 * 读取套餐与余额。
 * @param {import('./credentials.js').ZcodeAccount} account
 * @param {string} appVersion
 * @returns {Promise<{ plans: any[], balances: any[], serverTime: number }>}
 */
export async function fetchBalance(account, appVersion) {
  const version = resolveApiAppVersion(appVersion)
  const url = `${HOST}/api/v1/zcode-plan/billing/balance?app_version=${encodeURIComponent(version)}`
  const payload = await requestJson('额度查询', url, { method: 'GET', headers: apiHeaders(account, version) })
  const data = payload.data ?? {}
  return {
    plans: Array.isArray(data.plans) ? data.plans : [],
    balances: Array.isArray(data.balances) ? data.balances : [],
    serverTime: Number(data.server_time ?? 0) || Math.floor(Date.now() / 1000),
  }
}

/**
 * 从权益列表与权能列表中提取人类可读的专属模型名称列表。
 * @param {any[]} entitlements
 * @param {string[]} capabilities
 * @returns {string[]}
 */
export function extractPlanModels(entitlements = [], capabilities = []) {
  /** @type {string[]} */
  const models = []
  const seen = new Set()
  const add = (raw) => {
    const clean = String(raw ?? '').trim()
    if (!clean) return
    const key = clean.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    models.push(clean)
  }

  for (const e of Array.isArray(entitlements) ? entitlements : []) {
    add(e?.show_name ?? e?.model_name ?? e?.model)
  }

  if (models.length === 0) {
    for (const c of Array.isArray(capabilities) ? capabilities : []) {
      const s = String(c ?? '').trim()
      if (!s.toLowerCase().startsWith('model:')) continue
      const formatted = s
        .slice(6)
        .replace(/^glm-/i, 'GLM-')
        .replace(/-flash$/i, '-Flash')
        .replace(/-turbo$/i, '-Turbo')
        .replace(/-air$/i, '-Air')
        .replace(/-pro$/i, '-Pro')
      add(formatted)
    }
  }
  return models
}

/**
 * 一次完整探测：活动 + 套餐 + 余额。
 *
 * @typedef {object} WelfarePlan
 * @property {string} planId
 * @property {string} name
 * @property {string} status
 * @property {number} startsAt
 * @property {number} endsAt
 * @property {boolean} claimable 现在是否在可领窗口内
 * @property {boolean} claimed 是否已在 plans 中出现
 * @property {number} grantUnits 总授予额度
 * @property {string[]} capabilities
 * @property {string[]} models 专属模型列表（如 ['GLM-5.3-Flash']）
 * @property {number} effectiveAt 权益生效时间（0 = 未给出）
 *
 * @typedef {object} WelfareSnapshot
 * @property {number} observedAt
 * @property {number} serverTime
 * @property {WelfarePlan[]} plans
 * @property {any[]} balances
 * @property {number} pendingUnits 待生效额度总计
 * @property {number} availableUnits 已生效可用额度总计
 * @property {string[]} notes
 *
 * @param {import('./credentials.js').ZcodeAccount} account
 * @param {string} appVersion
 * @returns {Promise<WelfareSnapshot>}
 */
export async function survey(account, appVersion) {
  /** @type {string[]} */
  const notes = []
  /** @type {{ plans: any[], balances: any[], serverTime: number }} */
  let balance = { plans: [], balances: [], serverTime: 0 }
  try {
    balance = await fetchBalance(account, appVersion)
  } catch (error) {
    notes.push(`额度查询失败：${error instanceof Error ? error.message : String(error)}`)
  }

  /** @type {any[]} */
  let deliveries = []
  try {
    const m = await fetchMarketing(account, appVersion)
    deliveries = m.deliveries
    if (balance.serverTime === 0) balance.serverTime = m.serverTime
  } catch (error) {
    notes.push(`活动探测失败：${error instanceof Error ? error.message : String(error)}`)
  }

  // 同时也探测 billing/preview，防止部分套餐仅在 preview 端点下发
  try {
    const prev = await fetchPreview(account, appVersion)
    if (Array.isArray(prev.plans) && prev.plans.length > 0) {
      for (const p of prev.plans) {
        deliveries.push({ zcode_plan: p })
      }
    }
  } catch {}

  const now = balance.serverTime || Math.floor(Date.now() / 1000)
  const byPlanId = new Map(balance.plans.map((p) => [String(p.plan_id ?? ''), p]))

  /** @type {WelfarePlan[]} */
  const plans = []
  const seen = new Set()

  // ① 来自活动卡片：可领的东西
  for (const d of deliveries) {
    for (const card of normalizeDelivery(d)) {
      const key = `${card.planId}`
      if (card.planId === '' || seen.has(key)) continue
      seen.add(key)
      const existing = byPlanId.get(card.planId)
      const exEnts = Array.isArray(existing?.entitlements) ? existing.entitlements : []
      const exCaps = exEnts.flatMap((e) => (Array.isArray(e.capabilities) ? e.capabilities : []))
      const exEff = exEnts.reduce((min, e) => {
        const v = Number(e.effective_at ?? 0)
        return v > 0 && (min === 0 || v < min) ? v : min
      }, 0)
      const exEnds = Number(existing?.ends_at ?? existing?.endsAt ?? 0)
      const exModels = extractPlanModels(exEnts, exCaps)
      plans.push({
        planId: card.planId,
        name: card.name,
        status: existing ? String(existing.status ?? 'active') : 'claimable',
        startsAt: card.startsAt || Number(existing?.starts_at ?? existing?.startsAt ?? 0),
        endsAt: card.endsAt || exEnds,
        claimable: card.claimable && !existing,
        claimed: existing !== undefined,
        grantUnits: card.grantUnits || exEnts.reduce((sum, e) => sum + (Number(e.grant_units) || 0), 0),
        capabilities: card.capabilities.length > 0 ? card.capabilities : exCaps,
        models: card.models.length > 0 ? card.models : exModels,
        effectiveAt: card.effectiveAt || exEff,
      })
    }
  }

  // ② 来自 balance：已领取 / 已生效的套餐（活动卡片消失后仍要看得到）
  for (const p of balance.plans) {
    const planId = String(p.plan_id ?? '')
    if (planId === '' || seen.has(planId)) continue
    seen.add(planId)
    const entitlements = Array.isArray(p.entitlements) ? p.entitlements : []
    const capabilities = entitlements.flatMap((e) => (Array.isArray(e.capabilities) ? e.capabilities : []))
    plans.push({
      planId,
      name: String(p.name ?? planId),
      status: String(p.status ?? ''),
      startsAt: Number(p.starts_at ?? 0),
      endsAt: Number(p.ends_at ?? 0),
      claimable: false,
      claimed: true,
      grantUnits: entitlements.reduce((sum, e) => sum + (Number(e.grant_units) || 0), 0),
      capabilities,
      models: extractPlanModels(entitlements, capabilities),
      effectiveAt: entitlements.reduce((min, e) => {
        const v = Number(e.effective_at ?? 0)
        return v > 0 && (min === 0 || v < min) ? v : min
      }, 0),
    })
  }

  // ③ 待生效与已生效额度：
  // 官方已领取的 start-plan 会在 plans 中给出 effective_at 与 ends_at。
  // 在 effective_at <= now < ends_at 期间，即使 upstream balances 数组存在同步延迟，
  // 领取的福利也是处于已生效可用状态，平滑过渡。
  let pendingUnits = 0
  let planAvailableUnits = 0
  for (const p of balance.plans) {
    const exp = Number(p.ends_at ?? p.endsAt ?? 0)
    for (const e of Array.isArray(p.entitlements) ? p.entitlements : []) {
      const grant = Number(e.grant_units) || 0
      const eff = Number(e.effective_at ?? 0)
      if (eff > now) {
        pendingUnits += grant
      } else if (eff <= now && (exp === 0 || exp > now)) {
        planAvailableUnits += grant
      }
    }
  }

  let balanceUnits = 0
  for (const b of balance.balances) {
    const n = Number(b.available_units ?? b.remaining_units ?? 0)
    if (Number.isFinite(n) && n > 0) balanceUnits += n
  }

  // B2：balances 数组存在（哪怕全 0）就以余额为准——grant_units 是授予总量
  // 不是剩余量，回退只会虚高额度和掩盖耗尽。仅 balances 整个缺失时才回退。
  const availableUnits = balance.balances.length > 0 ? balanceUnits : planAvailableUnits

  return {
    observedAt: Date.now(),
    serverTime: now,
    plans: plans.sort((a, b) => Number(b.claimable) - Number(a.claimable) || a.startsAt - b.startsAt),
    balances: balance.balances,
    pendingUnits,
    availableUnits,
    notes,
  }
}

/**
 * 把一条 delivery 归一成零或多个活动卡片。
 *
 * 上游形状不对外承诺，所以这里做防御式解析：优先提取含有完整
 * 授予额度与模型权能的 zcode_plan 对象，避免被按钮参数里的空 stub 覆盖。
 * @param {any} delivery
 * @returns {Array<{ planId: string, name: string, startsAt: number, endsAt: number, claimable: boolean, grantUnits: number, capabilities: string[], models: string[], effectiveAt: number }>}
 */
export function normalizeDelivery(delivery) {
  /** @type {Map<string, any>} */
  const seen = new Map()

  /** @param {any} node */
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }

    const zp = node.zcode_plan ?? (node.plan_id || node.planId ? node : null)
    if (zp && (zp.plan_id || zp.planId)) {
      const planId = String(zp.plan_id ?? zp.planId ?? '')
      const now = Math.floor(Date.now() / 1000)
      const startsAt = Number(zp.starts_at ?? zp.startsAt ?? 0)
      const endsAt = Number(zp.ends_at ?? zp.endsAt ?? 0)
      const entitlements = Array.isArray(zp.entitlements) ? zp.entitlements : []
      const grantUnits = entitlements.reduce((s, e) => s + (Number(e.grant_units) || 0), Number(zp.grant_units) || 0)
      const name = String(zp.name ?? zp.title ?? planId)
      const capabilities = entitlements.flatMap((e) => (Array.isArray(e.capabilities) ? e.capabilities : []))
      const models = extractPlanModels(entitlements, capabilities)
      const effectiveAt = Number(zp.effective_at ?? entitlements[0]?.effective_at ?? 0)

      const card = {
        planId,
        name,
        startsAt,
        endsAt,
        claimable:
          zp.claimed !== true &&
          zp.claimed_at === undefined &&
          (endsAt === 0 || endsAt > now) &&
          (startsAt === 0 || startsAt <= now),
        grantUnits,
        capabilities,
        models,
        effectiveAt,
      }

      const existing = seen.get(planId)
      if (!existing || card.grantUnits > existing.grantUnits || (!existing.capabilities.length && card.capabilities.length) || (!existing.models.length && card.models.length)) {
        seen.set(planId, card)
      }
    }

    for (const value of Object.values(node)) {
      if (value !== null && typeof value === 'object') visit(value)
    }
  }

  visit(delivery)
  return [...seen.values()]
}

// ── 领取 ──────────────────────────────────────────────────────────────────────

/**
 * 领取一个套餐。
 *
 * 需要 `X-Aliyun-Captcha-Verify-Param`。参数由调用方（验证码求解器）提供；
 * 没有参数时上游返回 3007，这里翻译成可操作错误而不是静默失败。
 *
 * @param {import('./credentials.js').ZcodeAccount} account
 * @param {string} appVersion
 * @param {string} planId
 * @param {{ captchaVerifyParam?: string, captchaRegion?: string }} [verification]
 * @returns {Promise<{ ok: true, message: string }>}
 */
export async function claim(account, appVersion, planId, verification = {}) {
  const version = resolveApiAppVersion(appVersion)
  const url = `${HOST}/api/v1/zcode-plan/billing/claim?app_version=${encodeURIComponent(version)}`
  /** @type {Record<string, string>} */
  const headers = { ...apiHeaders(account, version) }
  if (verification.captchaVerifyParam) {
    headers['X-Aliyun-Captcha-Verify-Param'] = verification.captchaVerifyParam
    headers['X-Aliyun-Captcha-Verify-Region'] = verification.captchaRegion || 'cn'
  }
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ plan_id: planId }),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    })
  } catch (cause) {
    throw zerr('NETWORK', `领取请求失败：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const text = await response.text()
  let payload
  try {
    payload = text === '' ? {} : JSON.parse(text)
  } catch {
    throw zerr('UPSTREAM_FORMAT', `领取接口返回非 JSON（HTTP ${response.status}）。`, { text: text.slice(0, 200) })
  }
  if (payload.code === 3007) {
    throw zerr('CAPTCHA_REQUIRED', '领取需要人机验证（3007）。请先在面板点「验证并领取」完成一次验证。', payload)
  }
  if (payload.code === 1003) {
    // target already exists —— 验证码已通过，只是这个活动已经领过。
    // 这不是失败，语义上等价于 already-claimed。
    return { ok: true, message: '该活动已领取过（1003 target already exists）', already: true }
  }
  if (payload.code === 1004 || (payload.msg && payload.msg.includes('no permission'))) {
    return { ok: false, code: 1004, message: '领取失败：验证已失效或无权限 (1004 no permission)', noPermission: true }
  }
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw zerr('UPSTREAM', `领取失败：HTTP ${response.status} code=${payload.code ?? '-'} ${payload.msg ?? payload.message ?? ''}`.trim(), payload)
  }
  return { ok: true, message: String(payload.message ?? payload.msg ?? 'Plan claimed successfully.') }
}

/**
 * 一次性领取所有当前可领的套餐。
 * @param {import('./credentials.js').ZcodeAccount} account
 * @param {string} appVersion
 * @param {{ captchaVerifyParam?: string, captchaRegion?: string, getVerification?: () => Promise<{ captchaVerifyParam?: string, captchaRegion?: string }> }} [verification]
 * @param {any} [precomputed] 调用方已完成的 survey 快照（C12，避免重复探测）
 * @returns {Promise<{ claimed: string[], failed: Array<{ planId: string, error: string }>, skipped: string[] }>}
 */
export async function claimAll(account, appVersion, verification = {}, precomputed = null) {
  // C12：调用方（pool.claimAll）已做过 survey 时直接复用
  const snapshot = (precomputed && Array.isArray(precomputed.plans)) ? precomputed : await survey(account, appVersion)
  /** @type {string[]} */
  const claimed = []
  /** @type {Array<{ planId: string, error: string }>} */
  const failed = []
  /** @type {string[]} */
  const skipped = []
  /** @returns {Promise<{ captchaVerifyParam?: string, captchaRegion?: string }>} */
  const solve = async () => {
    if (typeof verification.getVerification === 'function') {
      return await verification.getVerification()
    }
    return verification
  }
  for (const plan of snapshot.plans) {
    if (!plan.claimable) {
      skipped.push(plan.planId)
      continue
    }
    // A4：每个 plan 现场取一枚验证码——param 一次性消耗，不复用（复用必撞 3007）
    let verificationNow
    try {
      verificationNow = await solve()
    } catch (error) {
      failed.push({ planId: plan.planId, error: `验证码求解失败：${error instanceof Error ? error.message : String(error)}` })
      continue
    }
    try {
      const r = await claim(account, appVersion, plan.planId, verificationNow)
      if (r.ok) {
        claimed.push(`${plan.name}（${r.message}）`)
      } else if (r.noPermission) {
        failed.push({ planId: plan.planId, error: r.message, noPermission: true })
      } else {
        failed.push({ planId: plan.planId, error: r.message || '领取失败' })
      }
    } catch (error) {
      // 3007：验证码被上游判定失效——现解一枚重试一次
      if (/** @type {any} */ (error)?.code !== 'CAPTCHA_REQUIRED' || typeof verification.getVerification !== 'function') {
        failed.push({ planId: plan.planId, error: error instanceof Error ? error.message : String(error) })
        continue
      }
      try {
        const fresh = await verification.getVerification()
        const r2 = await claim(account, appVersion, plan.planId, fresh)
        if (r2.ok) {
          claimed.push(`${plan.name}（${r2.message}）`)
        } else {
          failed.push({ planId: plan.planId, error: r2.message || '领取失败' })
        }
      } catch (error2) {
        failed.push({ planId: plan.planId, error: error2 instanceof Error ? error2.message : String(error2) })
      }
    }
  }
  return { claimed, failed, skipped }
}

/** 供诊断：不包含任何 token。@param {import('./credentials.js').ZcodeAccount} account */
export function tokenFacts(account) {
  const p = jwtPayload(account.planToken)
  return { segments: account.planToken.split('.').length, claims: p === null ? null : Object.keys(p) }
}
