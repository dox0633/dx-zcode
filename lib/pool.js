/**
 * 账号池：多账号快照、额度缓存、轮询与故障切换。
 *
 * 关键事实：一个 `credentials.json` 只描述「当前登录」这一个账号。
 * 要管多账号，必须能拿到多份数据根：
 *   1. 内置：本机 ZCode 当前登录（默认）
 *   2. 外部：Z·SWITCH 账号库、或任意指向 `.zcode/v2` 的目录
 *
 * 每个账号的模型流量都走它自己的 app-server 进程，互不干扰。
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readAccount, describeAccount, resolveDataBaseDir, credentialPaths, locateCli, decryptValue, locateCli as _locate } from './credentials.js'
import { survey, claimAll } from './welfare.js'
import { AppServerClient } from './app-server.js'
import { prepareShadow, shadowRoot, shadowReady, ACCEPTED_FAMILIES } from './family-alias.js'
import { DATA_ROOT, readPersistedState, writePersistedState } from './state-store.js'

/** @typedef {import('./credentials.js').ZcodeAccount} ZcodeAccount */

/**
 * @typedef {object} PoolEntry
 * @property {string} id
 * @property {string} label
 * @property {string} source 'desktop' | 'external'
 * @property {string} dataBaseDir
 * @property {ZcodeAccount | null} account
 * @property {AppServerClient | null} client
 * @property {any} snapshot 最近一次福利快照
 * @property {string} error 最后一次错误（空 = 正常）
 * @property {number} updatedAt
 * @property {boolean} enabled 参与轮询
 * @property {boolean} exhausted 额度耗尽
 */

/** 每个账号的福利快照缓存 TTL：10 秒，保证额度消耗能近实时反映在面板上。 */
const SNAPSHOT_TTL_MS = 10000

/** 模型目录磁盘缓存：boot 期直接回缓存，不为读目录拉起 app-server。 */
const CATALOG_FILE = path.join(DATA_ROOT, 'model-catalog.json')
const CATALOG_DISK_TTL_MS = 10 * 60 * 1000
/** 目录内存 TTL（C1）：目录查询独立于快照 10s TTL，不再频繁开 session。 */
const CATALOG_MEM_TTL_MS = 5 * 60 * 1000
/** 单账号在途回合上限（B12）：超过后 pick() 优先调度其它账号。 */
const MAX_IN_FLIGHT = 2

/**
 * 目录是否由插件自建（A1）：只有这些目录允许递归删除。
 * 外部数据根（extraDataDirs / Z·SWITCH / 任意用户目录）一律只解除引用。
 * @param {string} dir
 * @returns {boolean}
 */
export function isPluginOwnedDir(dir) {
  if (!dir) return false
  const resolved = path.resolve(dir)
  if (resolved === path.resolve(DATA_ROOT)) return false
  return ['accounts', 'shadow', 'staging', 'gateway-scratch']
    .map((name) => path.join(DATA_ROOT, name))
    .some((base) => resolved === base || resolved.startsWith(base + path.sep))
}

/**
 * 目录是否属于插件托管账号库（C5）：用 DATA_ROOT 前缀判定，
 * 替代此前脆弱的 includes('accounts') 子串匹配。
 * @param {string} dir
 * @returns {boolean}
 */
function isManagedPath(dir) {
  const resolved = path.resolve(dir ?? '')
  return ['accounts', 'login-root', 'staging']
    .map((name) => path.join(DATA_ROOT, name))
    .some((base) => resolved === base || resolved.startsWith(base + path.sep))
}

/** @returns {{ models: any[], readAt: number } | null} */
function readCatalogDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'))
    if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.models)) return null
    const readAt = Number(raw.readAt ?? 0)
    if (!Number.isFinite(readAt) || readAt <= 0) return null
    return { models: raw.models, readAt }
  } catch {
    return null
  }
}

/** @param {any[]} models @returns {void} */
function writeCatalogDisk(models) {
  try {
    fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true })
    fs.writeFileSync(CATALOG_FILE, JSON.stringify({ models, readAt: Date.now() }))
  } catch {
    /* 缓存写失败只影响下次 boot 的加速，不影响运行。 */
  }
}

export class AccountPool {
  /**
   * @param {{ options: () => any, logger: any }} deps
   */
  constructor(deps) {
    this.options = deps.options
    this.logger = deps.logger ?? console
    /** @type {Map<string, PoolEntry>} */
    this.entries = new Map()
    /** @type {{ models: any[], sessionId: string, readAt: number } | null} */
    this.catalog = null
    this.loaded = false
    /** @type {(() => { param: string, region: string } | null) | null} */
    this.captchaProvider = null
    /** @type {(() => Promise<{ param: string, region: string }>) | null} */
    this.captchaSolver = null
    /** @type {(() => { solveNext: () => Promise<{ param: string, region: string }>, close: () => Promise<void> }) | null} */
    this.captchaSessionFactory = null
    /** 会话粘性绑定映射：sessionId -> { accountId, boundAt, lastUsedAt } */
    this.sessionBindings = new Map()
    const persisted = readPersistedState()
    this.defaultModel = typeof persisted.__defaultModel === 'string' && persisted.__defaultModel
      ? persisted.__defaultModel
      : 'GLM-5.3-Flash'
    /** 通道黑名单（B13）：accountId -> (providerId -> blacklistedUntil ms)。过期条目惰性清理。 */
    this.channelBlacklist = new Map()
    const rawBlacklist = persisted.__channelBlacklist
    if (rawBlacklist && typeof rawBlacklist === 'object') {
      const now = Date.now()
      for (const [accountId, channels] of Object.entries(rawBlacklist)) {
        if (!channels || typeof channels !== 'object') continue
        for (const [providerId, until] of Object.entries(channels)) {
          if (Number(until) > now) {
            const m = this.channelBlacklist.get(accountId) ?? new Map()
            m.set(providerId, Number(until))
            this.channelBlacklist.set(accountId, m)
          }
        }
      }
    }
  }

  /**
   * 标记 (账号, 通道) 近期不可用（B13）：1309 / 套餐到期 / project_token_invalid
   * 等持续性错误不再反复试错，带 TTL，续订或手动刷新后自动恢复。
   * @param {string} accountId
   * @param {string} providerId
   * @param {number} [ttlMs]
   * @returns {void}
   */
  markChannelUnavailable(accountId, providerId, ttlMs = 6 * 60 * 60 * 1000) {
    if (!accountId || !providerId) return
    const until = Date.now() + ttlMs
    const m = this.channelBlacklist.get(accountId) ?? new Map()
    m.set(providerId, until)
    this.channelBlacklist.set(accountId, m)
    const persisted = readPersistedState()
    const raw = (persisted.__channelBlacklist && typeof persisted.__channelBlacklist === 'object')
      ? persisted.__channelBlacklist
      : {}
    const entry = (raw[accountId] && typeof raw[accountId] === 'object') ? raw[accountId] : {}
    entry[providerId] = until
    raw[accountId] = entry
    persisted.__channelBlacklist = raw
    writePersistedState(persisted)
  }

  /**
   * 查询 (账号, 通道) 是否在黑名单内（过期自动清除）。
   * @param {string} accountId
   * @param {string} providerId
   * @returns {boolean}
   */
  isChannelBlacklisted(accountId, providerId) {
    if (!accountId || !providerId) return false
    const m = this.channelBlacklist.get(accountId)
    if (!m) return false
    const until = m.get(providerId)
    if (until === undefined) return false
    if (Date.now() > until) {
      m.delete(providerId)
      return false
    }
    return true
  }

  /** 重新扫描账号来源。@returns {Promise<void>} */
  async load() {
    const opts = this.options()
    /** @type {string[]} */
    const roots = []
    // ① 本机当前登录
    try {
      roots.push(resolveDataBaseDir(opts.zcodeDataBaseDir ?? ''))
    } catch {
      /* 下面统一处理空池。 */
    }
    // ② 显式配置的额外数据根（Z·SWITCH 导出、多开目录等）
    for (const extra of Array.isArray(opts.extraDataDirs) ? opts.extraDataDirs : []) {
      const dir = String(extra ?? '').trim()
      if (dir !== '') roots.push(path.resolve(dir))
    }
    // ③ Z·SWITCH 账号库
    for (const dir of zswitchRoots(opts)) roots.push(dir)
    // ④ 独立归档的托管账号库（accounts/ 目录下所有已添加的账号，彻底支持多账号共存）
    const accountsBase = path.join(DATA_ROOT, 'accounts')
    if (fs.existsSync(accountsBase)) {
      try {
        const subdirs = fs.readdirSync(accountsBase)
        for (const sub of subdirs) {
          const accDir = path.join(accountsBase, sub)
          if (fs.existsSync(path.join(accDir, '.zcode', 'v2', 'credentials.json'))) {
            const telemetry = path.join(accDir, '.zcode', 'v2', 'telemetry-state.json')
            try {
              const t = JSON.parse(fs.readFileSync(telemetry, 'utf8'))
              if (typeof t.deviceMid !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(t.deviceMid)) throw new Error('bad')
            } catch {
              fs.writeFileSync(telemetry, JSON.stringify({ deviceMid: randomUUID() }), { mode: 0o600 })
            }
            roots.push(accDir)
          }
        }
      } catch (e) {
        this.logger.warn?.(`[dx-zcode] 扫描 accounts 目录异常: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // ⑤ 兼容旧版 login-root（自动归档迁移至 accounts/ 独立目录）
    try {
      const loginRoot = path.join(DATA_ROOT, 'login-root')
      if (fs.existsSync(path.join(loginRoot, '.zcode', 'v2', 'credentials.json'))) {
        try {
          const acc = readAccount({ dataBaseDir: loginRoot, cliPath: opts.zcodeCliPath ?? '' })
          if (acc && acc.id) {
            const destDir = path.join(accountsBase, acc.id)
            if (!fs.existsSync(destDir)) {
              fs.mkdirSync(path.join(destDir, '.zcode', 'v2'), { recursive: true })
              const srcV2 = path.join(loginRoot, '.zcode', 'v2')
              for (const file of fs.readdirSync(srcV2)) {
                fs.copyFileSync(path.join(srcV2, file), path.join(destDir, '.zcode', 'v2', file))
              }
            }
            fs.rmSync(loginRoot, { recursive: true, force: true })
            roots.push(destDir)
          } else {
            roots.push(loginRoot)
          }
        } catch {
          roots.push(loginRoot)
        }
      }
    } catch {
      /* 无登录根。 */
    }

    /** @type {Set<string>} */
    const seen = new Set()
    /** @type {Map<string, PoolEntry>} */
    const next = new Map()

    const persisted = readPersistedState()
    for (const root of roots) {
      const normalized = path.resolve(root)
      if (seen.has(normalized)) continue
      seen.add(normalized)
      const paths = credentialPaths(normalized)
      let account = null
      let error = ''
      try {
        account = readAccount({ dataBaseDir: normalized, cliPath: opts.zcodeCliPath ?? '' })
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }

      const id = account?.id ?? `dir-${Buffer.from(normalized).toString('base64url').slice(0, 12)}`
      if (persisted[id]?.removed === true) {
        continue
      }

      // 关键：国内站登录写的是 zai_cn，而 CLI 的 start-plan 分支只认
      // zai / bigmodel。这里造影子数据根把 family 改写过去，否则
      // account:zai-start-plan 永远不会出现在模型目录里。
      // 托管登录根以及任何使用 OS 凭据库的数据根，都必须通过影子通道注入独立 env 密钥，
      // 保证 app-server 子进程能在完全无桌面 keyring 的环境下正常解密，彻底消除「System credential storage is unavailable」报错。
      let effectiveRoot = normalized
      let shadowed = false
      const rawCreds = fs.existsSync(paths.credentials) ? fs.readFileSync(paths.credentials, 'utf8') : ''
      const isOsMode = rawCreds.includes('enc:v2:os:')
      const hasLocalSecret = fs.existsSync(path.join(normalized, '.zcode', 'v2', 'credential-secret'))

      if (account !== null && account.provider !== '' && (!ACCEPTED_FAMILIES.has(account.provider) || isManagedPath(normalized) || (isOsMode && !hasLocalSecret))) {
        try {
          const cli = locateCli(opts.zcodeCliPath ?? '')
          const ready = shadowReady(normalized)
          let needsRebuild = !ready
          if (ready) {
            try {
              const srcMtime = fs.statSync(paths.credentials).mtimeMs
              const shadowCred = path.join(shadowRoot(normalized), '.zcode', 'v2', 'credentials.json')
              const shadowMtime = fs.statSync(shadowCred).mtimeMs
              if (srcMtime > shadowMtime) needsRebuild = true
            } catch {
              needsRebuild = true
            }
          }

          if (needsRebuild) {
            const raw = JSON.parse(fs.readFileSync(paths.credentials, 'utf8'))
            /** @type {Record<string, string>} */
            const secrets = {}
            for (const [key, value] of Object.entries(raw)) {
              if (typeof value !== 'string') continue
              secrets[key] = decryptValue(value, { cliPath: cli.path, credentialsFile: paths.credentials, dataBaseDir: normalized })
            }
            const shadow = prepareShadow({ dataBaseDir: normalized, secrets, logger: this.logger })
            effectiveRoot = shadow.root
            shadowed = true
            this.logger.info?.(`[dx-zcode] ${path.basename(normalized)}：启用影子通道（${shadow.family}），原目录未改动`)
          } else {
            effectiveRoot = shadowRoot(normalized)
            shadowed = true
          }

          account = readAccount({ dataBaseDir: effectiveRoot, cliPath: cli.path })
          account.dataBaseDir = effectiveRoot
        } catch (e) {
          this.logger.warn?.(`[dx-zcode] 影子通道准备失败：${e instanceof Error ? e.message : String(e)}`)
        }
      }

      // 若准备影子通道后 account 重新读取，刷新 id
      const entryId = account?.id ?? id
      const previous = this.entries.get(entryId)
      const isManagedAccount = isManagedPath(normalized)
      const providerName = account?.provider === 'bigmodel' ? 'BigModel' : account?.provider === 'zai_cn' ? '国内站' : '国际站'
      const fallbackLabel = isManagedAccount
        ? `托管号 · ${providerName}`
        : `桌面端 · ${providerName}`
      const rawName = account?.userName && account.userName !== 'None' ? account.userName : ''
      const accountName = rawName || account?.userEmail || previous?.label || fallbackLabel
      const sourceLabel = isManagedAccount ? '插件托管登录' : '本机桌面客户端'

      next.set(entryId, {
        id: entryId,
        label: accountName,
        source: previous?.source ?? (isManagedAccount ? 'external' : (normalized === resolveDataBaseDir(opts.zcodeDataBaseDir ?? '') ? 'desktop' : 'external')),
        sourceLabel,
        dataBaseDir: effectiveRoot,
        sourceRoot: normalized,
        shadowed,
        account,
        client: previous?.client ?? null,
        snapshot: previous?.snapshot ?? null,
        error,
        updatedAt: Date.now(),
        enabled: previous?.enabled ?? true,
        exhausted: previous?.exhausted ?? false,
      })
    }

    // 回收已消失账号的进程
    const previousIds = new Set(this.entries.keys())
    for (const [id, entry] of this.entries) {
      if (next.has(id)) continue
      try {
        entry.client?.dispose()
      } catch {
        /* 进程可能已退出。 */
      }
    }
    // 恢复持久化的启停状态（手动停用跨重启保留；已有内存状态的账号不覆盖）
    for (const [id, entry] of next) {
      const saved = persisted[id]
      if (saved === undefined || previousIds.has(id)) continue
      if (typeof saved.enabled === 'boolean') entry.enabled = saved.enabled
      if (typeof saved.exhausted === 'boolean') entry.exhausted = saved.exhausted
      if (Array.isArray(saved.ineligiblePlans)) entry.ineligiblePlans = new Set(saved.ineligiblePlans)
    }
    this.entries = next
    this.loaded = true
    this.catalog = null
    this.logger.info?.(`[dx-zcode] 账号池加载完成：${next.size} 个数据根`)
    // 异步探测刷新全部账号额度快照，精准识别额度耗尽状态
    void this.refreshAll().catch(() => {})
  }

  /** @returns {PoolEntry[]} */
  list() {
    return [...this.entries.values()]
  }

  /**
   * 选一个可用账号。
   * 调度优化策略：
   *   1. 会话粘性（Sticky Session Affinity）：同一对话固定同一账号，最大化利用服务端 KV Cache 与 Prompt Cache，减少上下文重算。
   *   2. 自动容灾转移（Failover）：当前账号发生异常或耗尽时，通过 excludeIds 排除故障账号，自动切换至备用账号并更新会话绑定。
   *   3. 主号优先（Primary First）：新对话优先分配给桌面端主账号，保证主号福利额度集中高效利用；主号耗尽或异常才切备用号。
   *
   * @param {string} [sessionId] 会话标识
   * @param {Set<string>} [excludeIds] 故障转移时需排除的账号 ID 集合
   * @returns {PoolEntry | null}
   */
  pick(sessionId = '', excludeIds = new Set()) {
    // 优先选择健康、未耗尽且本轮未被排除的账号
    let usable = this.list().filter((e) =>
      e.enabled &&
      !e.exhausted &&
      e.account !== null &&
      !excludeIds.has(e.id)
    )
    // 容灾兜底：若所有账号都被标记为耗尽（如探测活动包为空、或等待跨时段刷新），
    // 绝不能在本地直接判定为无可用账号，而应降级尝试调用（只排除本轮明确报错的账号）
    if (usable.length === 0) {
      usable = this.list().filter((e) =>
        e.enabled &&
        e.account !== null &&
        !excludeIds.has(e.id)
      )
    }
    if (usable.length === 0) return null

    // B12：优先调度未达并发上限的账号；全部满员时仍可调度（串行排队）
    const free = usable.filter((e) => (e.inFlight ?? 0) < MAX_IN_FLIGHT)
    const candidates = free.length > 0 ? free : usable

    // 1. 会话粘性：若此会话之前已有绑定账号，且该账号健康可用且未耗尽，继续使用该账号
    if (sessionId) {
      const binding = this.sessionBindings.get(sessionId)
      if (binding && !excludeIds.has(binding.accountId)) {
        const boundEntry = candidates.find((e) => e.id === binding.accountId)
        if (boundEntry && !boundEntry.exhausted) {
          binding.lastUsedAt = Date.now()
          boundEntry.updatedAt = Date.now()
          return boundEntry
        }
        // 绑定账号已耗尽或故障，解除粘性以便切换可用账号
        this.sessionBindings.delete(sessionId)
      }
    }

    // 2. 账号排序策略：
    //    a. 在途回合少者优先（B12，避开上游 per-account 并发上限）；
    //    b. 未耗尽优先；
    //    c. 明确有额度的账号（availableUnits > 0）最优先，剩余额度多者优先；
    //    d. 主号（桌面端）优先；
    //    e. 最空闲（最久未更新）优先。
    candidates.sort((a, b) => {
      const ai = a.inFlight ?? 0
      const bi = b.inFlight ?? 0
      if (ai !== bi) return ai - bi
      // 未耗尽账号绝对优先于已耗尽账号
      if (!a.exhausted && b.exhausted) return -1
      if (a.exhausted && !b.exhausted) return 1
      // 明确有额度的账号优先，剩余额度多者优先
      const aUnits = Number(a.snapshot?.availableUnits ?? 0)
      const bUnits = Number(b.snapshot?.availableUnits ?? 0)
      if (aUnits > 0 && bUnits <= 0) return -1
      if (bUnits > 0 && aUnits <= 0) return 1
      if (aUnits > 0 && bUnits > 0 && aUnits !== bUnits) return bUnits - aUnits
      // 同等条件下桌面端主号优先
      if (a.source === 'desktop' && b.source !== 'desktop') return -1
      if (b.source === 'desktop' && a.source !== 'desktop') return 1
      return a.updatedAt - b.updatedAt
    })
    const chosen = candidates[0]
    chosen.updatedAt = Date.now()

    // 3. 记录会话绑定
    if (sessionId) {
      this.bindSession(sessionId, chosen.id)
    }
    return chosen
  }

  /**
   * 绑定会话至指定账号，并维护 LRU 内存上限。
   * @param {string} sessionId
   * @param {string} accountId
   */
  bindSession(sessionId, accountId) {
    if (!sessionId) return
    this.sessionBindings.set(sessionId, {
      accountId,
      boundAt: Date.now(),
      lastUsedAt: Date.now(),
    })
    // B5：真 LRU —— 先清 24h 未活动的过期项，仍超限时按 lastUsedAt 只删最旧，
    // 不再一锅端（旧实现条件恒真导致超限时全部会话粘性丢失）。
    if (this.sessionBindings.size > 1000) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000
      for (const [sid, item] of this.sessionBindings) {
        if (item.lastUsedAt < cutoff) this.sessionBindings.delete(sid)
      }
      if (this.sessionBindings.size > 1000) {
        const sorted = [...this.sessionBindings.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
        const excess = this.sessionBindings.size - 800
        for (let i = 0; i < excess; i++) this.sessionBindings.delete(sorted[i][0])
      }
    }
  }

  /**
   * 取（或创建）某账号的 app-server 客户端。
   * @param {PoolEntry} entry
   * @returns {AppServerClient}
   */
  clientFor(entry) {
    if (entry.account === null) throw new Error(`账号 ${entry.label} 没有可用凭证`)
    if (entry.client !== null) return entry.client
    const client = new AppServerClient({
      cliPath: entry.account.cliPath,
      cliVersion: entry.account.cliVersion || '3.19.0',
      dataBaseDir: entry.account.dataBaseDir,
      logger: this.logger,
      captcha: this.captchaProvider,
    })
    entry.client = client
    return client
  }

  /**
   * 刷新一个账号的福利快照。
   * @param {PoolEntry} entry
   * @param {boolean} [force]
   * @returns {Promise<any>}
   */
  async refresh(entry, force = false) {
    if (entry.account === null) throw new Error(`${entry.label}：没有可用凭证`)
    const cached = entry.snapshot
    if (!force && cached !== null && Date.now() - Number(cached.observedAt ?? 0) < SNAPSHOT_TTL_MS) return cached
    const snapshot = await survey(entry.account, entry.account.cliVersion)
    // 若该账号已确认无某些活动的资格 (例如 1004 no permission)，更新计划状态为不可领
    if (entry.ineligiblePlans && entry.ineligiblePlans.size > 0 && Array.isArray(snapshot.plans)) {
      for (const p of snapshot.plans) {
        if (entry.ineligiblePlans.has(p.planId)) {
          p.claimable = false
          p.ineligible = true
          p.status = 'ineligible'
          p.reason = '该账号暂无此活动参与资格 (1004)'
        }
      }
    }
    entry.snapshot = snapshot
    entry.error = ''
    // B1：探测链路存在失败（notes 非空）时不判定耗尽——瞬时网络故障
    // 不得把健康账号打成 exhausted。等下次成功探测再评估。
    if (snapshot.notes.length === 0) {
      const hasBalance = snapshot.balances.length > 0 && snapshot.availableUnits > 0
      const hasPending = snapshot.pendingUnits > 0
      let nextExhausted = false
      if (!hasBalance && !hasPending && snapshot.plans.length === 0) {
        nextExhausted = true
      } else if (snapshot.balances.length > 0) {
        nextExhausted = snapshot.availableUnits === 0 && snapshot.pendingUnits === 0
      }
      if (entry.exhausted !== nextExhausted) {
        this.update(entry.id, { exhausted: nextExhausted })
      } else {
        entry.exhausted = nextExhausted
      }
    }
    return snapshot
  }

  /**
   * 限流并发执行辅助：避免多账号同时打上游触发 HTTP 429。
   * @template T, R
   * @param {T[]} items
   * @param {(item: T) => Promise<R>} fn
   * @param {number} [concurrency]
   * @param {number} [gapMs]
   * @returns {Promise<R[]>}
   */
  async _mapLimited(items, fn, concurrency = 2, gapMs = 200) {
    /** @type {R[]} */
    const results = new Array(items.length)
    let cursor = 0
    const worker = async () => {
      while (cursor < items.length) {
        const idx = cursor++
        if (idx > 0 && gapMs > 0) {
          await new Promise((r) => setTimeout(r, gapMs))
        }
        results[idx] = await fn(items[idx])
      }
    }
    const count = Math.min(concurrency, Math.max(1, items.length))
    await Promise.all(Array.from({ length: count }, () => worker()))
    return results
  }

  /**
   * 刷新全部账号（限流并发，避免触发上游 HTTP 429）。
   * @param {boolean} [force]
   * @returns {Promise<Array<{ id: string, ok: boolean, error?: string }>>}
   */
  async refreshAll(force = false) {
    return this._mapLimited(this.list(), async (entry) => {
      try {
        await this.refresh(entry, force)
        return { id: entry.id, ok: true }
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e)
        return { id: entry.id, ok: false, error: entry.error }
      }
    })
  }

  /**
   * 探测单个账号的最新福利与余额快照。
   * @param {string} id
   * @returns {Promise<{ id: string, ok: boolean, error?: string }>}
   */
  async refreshOne(id) {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`账号不存在：${id}`)
    try {
      await this.refresh(entry, true)
      return { id: entry.id, ok: true }
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e)
      return { id: entry.id, ok: false, error: entry.error }
    }
  }

  /**
   * 记录无资格活动 ID（如 1004），持久化后下次自动跳过。
   * @param {PoolEntry} entry
   * @param {string} planId
   */
  recordIneligiblePlan(entry, planId) {
    if (!entry || !planId) return
    if (!entry.ineligiblePlans) entry.ineligiblePlans = new Set()
    entry.ineligiblePlans.add(String(planId))
    this.update(entry.id, { ineligiblePlans: [...entry.ineligiblePlans] })
  }

  /**
   * 清除指定账号的无资格跳过标记并重新探测。
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async clearIneligible(id) {
    const entry = this.entries.get(id)
    if (!entry) return false
    const ok = this.update(id, { ineligiblePlans: [] })
    if (entry.account !== null) {
      await this.refresh(entry, true).catch(() => {})
    }
    return ok
  }

  /**
   * 多账号一键领取。
   * @param {{ captchaVerifyParam?: string, captchaRegion?: string, only?: string[], onProgress?: (info: any) => void, captchaSessionFactory?: () => any }} [options]
   * @returns {Promise<Array<{ id: string, label: string, claimed: string[], failed: any[], skipped: string[], error?: string }>>}
   */
  async claimAll(options = {}) {
    const onlyIds = Array.isArray(options.only) ? new Set(options.only) : null
    const targets = this.list().filter((e) => e.account !== null && (onlyIds === null || onlyIds.has(e.id) || (e.account?.userId && options.only.some((o) => o === e.account?.userId))))
    const emit = typeof options.onProgress === 'function' ? options.onProgress : () => {}

    const sessionFactory = options.captchaSessionFactory ?? this.captchaSessionFactory
    const reuseBrowser = Boolean(!options.captchaVerifyParam && sessionFactory)

    emit({
      phase: 'survey',
      current: 0,
      total: targets.length,
      reuseBrowser,
      stepText: `正在并发探测 ${targets.length} 个账号待领福利包与模型资格…`,
    })

    // 先做快速 survey 探测各账号当前是否有未领取的福利，避免无未领福利时盲目唤起验证求解
    const surveys = await this._mapLimited(targets, async (entry) => {
      try {
        const snap = await this.refresh(entry, true)
        const claimablePlans = (snap?.plans || []).filter((p) => p.claimable)
        return { entry, snap, claimablePlans }
      } catch {
        return { entry, snap: null, claimablePlans: [] }
      }
    })

    const results = []
    const claimableTargets = surveys.filter((s) => s.claimablePlans.length > 0)
    const noWorkTargets = surveys.filter((s) => s.claimablePlans.length === 0)

    for (const { entry, snap } of noWorkTargets) {
      const ineligibleNames = (snap?.plans || [])
        .filter((p) => p.ineligible)
        .map((p) => p.name || p.planId)
      const skipMsg = ineligibleNames.length > 0
        ? `1004 无资格自动跳过（${ineligibleNames.join(', ')}）`
        : '暂无待领取福利'
      results.push({ id: entry.id, label: entry.label, claimed: [], failed: [], skipped: [skipMsg] })
    }

    if (claimableTargets.length === 0) return results

    /** @type {{ solveNext: () => Promise<{ param: string, region: string }>, close: () => Promise<void> } | null} */
    const session = reuseBrowser ? sessionFactory() : null

    try {
      // 逐个账号串行领取。每个活动现场求解一次一次性 verifyParam（同一浏览器会话内复用，避免重复冷启动）。
      for (let idx = 0; idx < claimableTargets.length; idx++) {
        const { entry, snap, claimablePlans } = claimableTargets[idx]
        const firstPlanName = claimablePlans[0]?.name || claimablePlans[0]?.planId || '福利包'
        emit({
          phase: 'claiming',
          current: idx + 1,
          total: claimableTargets.length,
          reuseBrowser,
          accountId: entry.id,
          accountLabel: entry.label,
          stepText: `(${idx + 1}/${claimableTargets.length}) ${entry.label} · 正在验证并领取 ${firstPlanName}…`,
        })

        /** @type {{ getVerification?: () => Promise<{ captchaVerifyParam?: string, captchaRegion?: string }> }} */
        let verification = {}
        if (session !== null) {
          verification = {
            getVerification: async () => {
              const solved = await session.solveNext()
              return { captchaVerifyParam: solved.param, captchaRegion: solved.region }
            },
          }
        } else if (this.captchaSolver !== null) {
          verification = {
            getVerification: async () => {
              const solved = await this.captchaSolver({ force: true, consume: true })
              return { captchaVerifyParam: solved.param, captchaRegion: solved.region }
            },
          }
        }

        try {
          const account = /** @type {ZcodeAccount} */ (entry.account)
          const r = await claimAll(account, account.cliVersion, { ...options, ...verification }, snap)

          const realFailed = []
          const extraSkipped = []
          for (const f of r.failed ?? []) {
            if (f.noPermission && f.planId) {
              this.recordIneligiblePlan(entry, f.planId)
              const matched = claimablePlans.find((p) => p.planId === f.planId)
              extraSkipped.push(`${matched?.name || f.planId}: 1004 无资格（已记忆跳过）`)
            } else {
              realFailed.push(f)
            }
          }

          await this.refresh(entry, true).catch(() => {})
          results.push({
            id: entry.id,
            label: entry.label,
            claimed: r.claimed ?? [],
            failed: realFailed,
            skipped: [...extraSkipped],
          })
        } catch (e) {
          results.push({
            id: entry.id,
            label: entry.label,
            claimed: [],
            failed: [],
            skipped: [],
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
    } finally {
      if (session !== null) {
        await session.close().catch(() => {})
      }
    }
    return results
  }

  /**
   * 读模型目录（取第一个可用账号的 CLI 报告）。
   *
   * 三级缓存：内存 30s → 磁盘 10min → 现场 spawn app-server。
   * 磁盘缓存让 boot 期的目录查询不再拉起 CLI 子进程。
   * @param {boolean} [force]
   * @returns {Promise<any[]>}
   */
  async readCatalog(force = false) {
    // 对话框可能在延迟加载完成前查询目录 —— 主动加载，别返回空列表
    if (!this.loaded) await this.load().catch(() => {})
    const now = Date.now()
    if (!force && this.catalog !== null && now - this.catalog.readAt < CATALOG_MEM_TTL_MS) {
      return this.catalog.models
    }
    if (!force) {
      const disk = readCatalogDisk()
      if (disk !== null && now - disk.readAt < CATALOG_DISK_TTL_MS) {
        this.catalog = { models: disk.models, sessionId: '', readAt: disk.readAt }
        return disk.models
      }
    }
    try {
      const entry = this.pick() ?? this.list().find((e) => e.account !== null) ?? null
      if (entry === null) return this.getCachedModels()
      const client = this.clientFor(entry)
      const { createSession, closeSession } = await import('./app-server.js')
      await client.ensureStarted()
      const session = await createSession(client, { workspacePath: process.cwd() })
      this.catalog = { models: session.models, sessionId: session.sessionId, readAt: Date.now() }
      writeCatalogDisk(session.models)
      if (session?.sessionId) {
        void closeSession(client, session.sessionId).catch(() => {})
      }
      return session.models
    } catch (e) {
      const fallback = this.getCachedModels()
      if (fallback.length > 0) {
        this.logger.warn?.(`[dx-zcode] 实时更新模型目录失败，使用已缓存目录（${fallback.length} 个模型）：${e instanceof Error ? e.message : String(e)}`)
        return fallback
      }
      throw e
    }
  }

  /**
   * 极速同步获取已缓存的模型目录，不主动拉起 app-server，保证零延迟响应。
   * @returns {any[]}
   */
  getCachedModels() {
    if (this.catalog !== null && Array.isArray(this.catalog.models) && this.catalog.models.length > 0) {
      return this.catalog.models
    }
    const disk = readCatalogDisk()
    if (disk !== null && Array.isArray(disk.models) && disk.models.length > 0) {
      return disk.models
    }
    return []
  }

  /**
   * 获取网关默认路由模型 ID（默认推荐 GLM-5.3-Flash，优先抵扣官方福利包 Token）。
   * @returns {string}
   */
  getDefaultModel() {
    return this.defaultModel || 'GLM-5.3-Flash'
  }

  /**
   * 变更网关默认路由模型，并持久化到磁盘状态。
   * @param {string} modelId
   * @returns {boolean}
   */
  setDefaultModel(modelId) {
    const id = String(modelId ?? '').trim()
    if (!id) return false
    this.defaultModel = id
    const persisted = readPersistedState()
    persisted.__defaultModel = id
    writePersistedState(persisted)
    return true
  }

  /**
   * 移除一个账号（支持托管账号与本机桌面端账号）。
   * 桌面端账号移除后标记持久化移除，不删除本地桌面客户端原生配置，不再接入插件调度。
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async removeAccount(id) {
    let targetEntry = this.entries.get(id)
    if (!targetEntry) {
      for (const e of this.entries.values()) {
        if (e.id === id || e.account?.id === id || e.account?.userId === id) {
          targetEntry = e
          break
        }
      }
    }
    if (!targetEntry) return false

    try { targetEntry.client?.dispose() } catch {}

    const persisted = readPersistedState()
    persisted[targetEntry.id] = { ...(persisted[targetEntry.id] || {}), removed: true, enabled: false }
    writePersistedState(persisted)

    if (targetEntry.source === 'desktop') {
      // 本机桌面客户端账号：清理其影子目录与进程副本，保留本地桌面原生主目录
      if (targetEntry.shadowed && targetEntry.dataBaseDir && targetEntry.dataBaseDir !== targetEntry.sourceRoot
          && isPluginOwnedDir(targetEntry.dataBaseDir)) {
        try { fs.rmSync(targetEntry.dataBaseDir, { recursive: true, force: true }) } catch {}
      }
    } else {
      // 托管账号：仅清理插件自建目录（A1）。外部数据根（Z·SWITCH / extraDataDirs
      // 指向的用户目录）绝不递归删除，只解除调度引用。
      const rawDir = targetEntry.dataBaseDir
      if (rawDir && isPluginOwnedDir(rawDir)) {
        try { fs.rmSync(rawDir, { recursive: true, force: true }) } catch {}
      }
      const accountsBase = path.join(DATA_ROOT, 'accounts')
      if (fs.existsSync(accountsBase)) {
        try {
          for (const sub of fs.readdirSync(accountsBase)) {
            if (sub === id || sub === targetEntry.id || sub === targetEntry.account?.id) {
              fs.rmSync(path.join(accountsBase, sub), { recursive: true, force: true })
            }
          }
        } catch {}
      }
      const loginRoot = path.join(DATA_ROOT, 'login-root')
      if (rawDir === loginRoot || targetEntry.sourceRoot === loginRoot) {
        try { fs.rmSync(loginRoot, { recursive: true, force: true }) } catch {}
      }
    }

    this.entries.delete(targetEntry.id)
    await this.load()
    return true
  }

  /**
   * 重新接入被移除的本机桌面账号。
   * @returns {Promise<boolean>}
   */
  async restoreDesktopAccount() {
    const opts = this.options()
    const desktopRoot = resolveDataBaseDir(opts.zcodeDataBaseDir ?? '')
    if (desktopRoot) {
      try {
        const acc = readAccount({ dataBaseDir: desktopRoot, cliPath: opts.zcodeCliPath ?? '' })
        const id = acc?.id ?? `dir-${Buffer.from(desktopRoot).toString('base64url').slice(0, 12)}`
        const persisted = readPersistedState()
        if (persisted[id]) {
          delete persisted[id].removed
          persisted[id].enabled = true
          writePersistedState(persisted)
        }
      } catch {}
    }
    await this.load()
    return true
  }

  /**
   * 检查某个模型是否被用户停用。
   * @param {string} modelId
   * @returns {boolean}
   */
  isModelDisabled(modelId) {
    const id = String(modelId ?? '').trim().toLowerCase()
    if (!id) return false
    const persisted = readPersistedState()
    const list = Array.isArray(persisted.__disabledModels) ? persisted.__disabledModels : []
    return list.some((m) => String(m).trim().toLowerCase() === id)
  }

  /**
   * 获取所有被停用的模型 ID 列表。
   * @returns {string[]}
   */
  getDisabledModels() {
    const persisted = readPersistedState()
    return Array.isArray(persisted.__disabledModels) ? persisted.__disabledModels : []
  }

  /**
   * 开启或停用指定渠道模型。
   * @param {string} modelId
   * @param {boolean} enabled
   * @returns {boolean}
   */
  setModelEnabled(modelId, enabled) {
    const id = String(modelId ?? '').trim()
    if (!id) return false
    const persisted = readPersistedState()
    let list = Array.isArray(persisted.__disabledModels) ? [...persisted.__disabledModels] : []
    const norm = id.toLowerCase()
    list = list.filter((m) => String(m).trim().toLowerCase() !== norm)
    if (!enabled) {
      list.push(id)
    }
    persisted.__disabledModels = list
    writePersistedState(persisted)
    return true
  }

  /**
   * 严格仅获取 ZCode 官方渠道模型（剔除所有外部非 ZCode 模型），并规范化数据结构。
   * @returns {any[]}
   */
  getZcodeModels() {
    const rawList = this.getCachedModels()
    const ORDER = ['GLM-5.3-Flash', 'GLM-5.3', 'GLM-5.2', 'GLM-5-Turbo']
    const disabledList = this.getDisabledModels().map((m) => m.toLowerCase())
    const attachEnabled = (list) => list.map((m) => {
      const mid = String(m.id || m.label || '').toLowerCase()
      return {
        ...m,
        enabled: !disabledList.includes(mid),
      }
    })

    // 标准兜底模型清单（确保在 app-server 未启动时也能秒级呈现 ZCode 官方模型特性）
    const CANONICAL = [
      {
        id: 'GLM-5.3-Flash',
        label: 'GLM-5.3-Flash',
        providerId: 'account:zai-start-plan',
        providerLabel: 'Start Plan (福利通道)',
        quotaType: 'welfare',
        quotaDesc: '福利额度专享 · 优先抵扣官方福利包 Token',
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        reasoning: { defaultLevel: 'max' },
        hasReasoning: true,
        hasVision: true,
      },
      {
        id: 'GLM-5.3',
        label: 'GLM-5.3',
        providerId: 'account:zai-individual-coding-plan',
        providerLabel: 'Individual Coding Plan',
        quotaType: 'balance',
        quotaDesc: '旗舰深度思考 · 消耗账户通用额度',
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        reasoning: { defaultLevel: 'max' },
        hasReasoning: true,
        hasVision: true,
      },
      {
        id: 'GLM-5.2',
        label: 'GLM-5.2',
        providerId: 'account:zai-start-plan',
        providerLabel: 'Start Plan',
        quotaType: 'balance',
        quotaDesc: '高精度主力模型 · 消耗账户通用额度',
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        reasoning: { defaultLevel: 'max' },
        hasReasoning: true,
        hasVision: true,
      },
      {
        id: 'GLM-5-Turbo',
        label: 'GLM-5-Turbo',
        providerId: 'account:zai-start-plan',
        providerLabel: 'Start Plan',
        quotaType: 'balance',
        quotaDesc: '极速轻量模型 · 消耗账户通用额度',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        reasoning: { defaultLevel: 'enabled' },
        hasReasoning: true,
        hasVision: false,
      },
    ]

    if (!Array.isArray(rawList) || rawList.length === 0) {
      return attachEnabled(CANONICAL)
    }

    // 严格过滤属于 ZCode 官方渠道的模型：
    // providerId 以 account:zai 或 account:bigmodel 或 zcode 开头，或者 mid/label 以 GLM- 开头
    const zcodeOnly = rawList.filter((m) => {
      const pid = String(m.ref?.providerId ?? '').toLowerCase()
      const mid = String(m.ref?.modelId ?? m.label ?? '').toUpperCase()
      return (pid.startsWith('account:zai') || pid.startsWith('account:bigmodel') || pid.includes('zcode')) && mid.startsWith('GLM-')
    })

    if (zcodeOnly.length === 0) {
      return attachEnabled(CANONICAL)
    }

    // 按 modelId 去重（优先保留 start-plan 渠道，因其对接福利套餐额度）
    const map = new Map()
    for (const m of zcodeOnly) {
      const modelId = String(m.ref?.modelId || m.label || '').trim()
      if (!modelId) continue
      const isStartPlan = String(m.ref?.providerId || '').includes('start-plan')
      if (!map.has(modelId) || isStartPlan) {
        map.set(modelId, m)
      }
    }

    const items = Array.from(map.values()).map((m) => {
      const modelId = String(m.ref?.modelId || m.label)
      const isFlash = modelId.toLowerCase().includes('flash')
      const isTurbo = modelId.toLowerCase().includes('turbo')
      const isStartPlan = String(m.ref?.providerId || '').includes('start-plan')

      return {
        id: modelId,
        label: m.label || modelId,
        providerId: String(m.ref?.providerId || (isStartPlan ? 'account:zai-start-plan' : 'account:zai-individual-coding-plan')),
        providerLabel: m.providerLabel || (isStartPlan ? 'Start Plan (福利通道)' : 'Individual Coding Plan'),
        quotaType: isFlash ? 'welfare' : 'balance',
        quotaDesc: isFlash ? '福利额度专享 · 优先抵扣官方福利包 Token' : (modelId === 'GLM-5.3' ? '旗舰深度思考 · 消耗通用额度' : '消耗通用额度'),
        contextWindow: m.contextWindow || (isTurbo ? 200000 : 1000000),
        maxOutputTokens: m.maxOutputTokens || (isTurbo ? 64000 : 128000),
        reasoning: m.reasoning || { defaultLevel: 'max' },
        hasReasoning: Boolean(m.reasoning && m.reasoning.defaultLevel !== 'disabled'),
        hasVision: Boolean(m.properties?.inputFormat?.supportsImage),
      }
    })

    items.sort((a, b) => {
      const idxA = ORDER.indexOf(a.id)
      const idxB = ORDER.indexOf(b.id)
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB)
    })

    return attachEnabled(items)
  }

  /**
   * 供 UI 的账号视图（不含任何 token），自动合并相同用户的多通道凭据，杜绝重复卡片。
   * @returns {any[]}
   */
  view() {
    /** @type {Map<string, any>} */
    const userMap = new Map()

    for (const entry of this.list()) {
      // 聚合规则：
      // 仅当「本机桌面客户端」与「托管账号」拥有完全相同的非空 userId 和站点时，才聚合为双通道；
      // 不同的托管账号（在 accounts/ 下独立存储）始终各展示独立卡片，绝不互相合并吞并。
      const p = entry.account?.provider || 'unknown'
      const family = (p === 'bigmodel' || p === 'zai_cn') ? 'cn' : (p === 'zai' ? 'global' : p)
      const uid = entry.account?.userId ? String(entry.account.userId).trim() : ''

      let userKey = entry.id
      if (entry.source === 'desktop' && uid) {
        userKey = `identity:${family}:${uid}`
      } else if (entry.source === 'external' && uid) {
        const hasDesktopSameUser = this.list().some((e) => e.source === 'desktop' && e.account?.userId === uid)
        if (hasDesktopSameUser) {
          userKey = `identity:${family}:${uid}`
        } else {
          userKey = entry.id
        }
      }
      const existing = userMap.get(userKey)

      const snapshot = entry.snapshot
      const welfare = snapshot === null ? null : {
        observedAt: snapshot.observedAt,
        serverTime: snapshot.serverTime,
        pendingUnits: snapshot.pendingUnits,
        availableUnits: snapshot.availableUnits,
        plans: snapshot.plans,
        balances: snapshot.balances,
        notes: snapshot.notes,
      }

      if (existing === undefined) {
        userMap.set(userKey, {
          id: entry.id,
          relatedIds: [entry.id],
          label: entry.label,
          userName: (entry.account?.userName && entry.account.userName !== 'None' ? entry.account.userName : '') || entry.account?.userEmail || entry.label,
          userEmail: entry.account?.userEmail || '',
          userAvatar: entry.account?.userAvatar || '',
          userId: entry.account?.userId || '',
          source: entry.source,
          sourceLabel: entry.sourceLabel || (entry.source === 'desktop' ? '本机桌面客户端' : '插件托管登录'),
          enabled: entry.enabled,
          exhausted: entry.exhausted,
          error: entry.error,
          provider: entry.account?.provider ?? 'unknown',
          cliVersion: entry.account?.cliVersion ?? '',
          dataBaseDir: entry.dataBaseDir,
          ineligiblePlans: [...(entry.ineligiblePlans ?? [])],
          account: entry.account === null ? null : describeAccount(entry.account),
          welfare,
        })
      } else {
        // 同一真实账号：合并底层通道，界面仅保留一张卡片
        existing.relatedIds.push(entry.id)
        if (!existing.userAvatar && entry.account?.userAvatar) existing.userAvatar = entry.account.userAvatar
        if (!existing.userEmail && entry.account?.userEmail) existing.userEmail = entry.account.userEmail
        existing.sourceLabel = '本机与托管双通道'
        if (entry.ineligiblePlans && entry.ineligiblePlans.size > 0) {
          existing.ineligiblePlans = [...new Set([...(existing.ineligiblePlans ?? []), ...entry.ineligiblePlans])]
        }
        if (welfare !== null) {
          if (existing.welfare === null) {
            existing.welfare = welfare
          } else {
            // 合并福利数据：取最大 availableUnits、最大 pendingUnits，并保留非空的 balances 与 plans
            existing.welfare.availableUnits = Math.max(existing.welfare.availableUnits ?? 0, welfare.availableUnits ?? 0)
            existing.welfare.pendingUnits = Math.max(existing.welfare.pendingUnits ?? 0, welfare.pendingUnits ?? 0)
            if ((!existing.welfare.balances || existing.welfare.balances.length === 0) && welfare.balances?.length) {
              existing.welfare.balances = welfare.balances
            }
            if ((!existing.welfare.plans || existing.welfare.plans.length === 0) && welfare.plans?.length) {
              existing.welfare.plans = welfare.plans
            }
          }
        }
        if (!entry.enabled) existing.enabled = false
      }
    }

    return [...userMap.values()]
  }

  /**
   * @param {string} id
   * @param {{ enabled?: boolean, exhausted?: boolean }} patch
   * @returns {boolean}
   */
  update(id, patch) {
    const target = this.entries.get(id)
    const toUpdate = []
    if (target !== undefined) {
      toUpdate.push(target)
      const p = target.account?.provider || 'unknown'
      const targetFamily = (p === 'bigmodel' || p === 'zai_cn') ? 'cn' : (p === 'zai' ? 'global' : p)
      const userKey = target.account?.userId || target.account?.userEmail || target.account?.userName
      if (userKey) {
        for (const [k, e] of this.entries) {
          const ep = e.account?.provider || 'unknown'
          const eFamily = (ep === 'bigmodel' || ep === 'zai_cn') ? 'cn' : (ep === 'zai' ? 'global' : ep)
          if (k !== id && eFamily === targetFamily && (e.account?.userId === userKey || e.account?.userEmail === userKey || e.account?.userName === userKey)) {
            toUpdate.push(e)
          }
        }
      }
    } else {
      for (const e of this.entries.values()) {
        if (e.id === id) toUpdate.push(e)
      }
    }

    if (toUpdate.length === 0) return false

    let persisted = {}
    try {
      persisted = readPersistedState()
    } catch {
      persisted = {}
    }

    for (const entry of toUpdate) {
      if (typeof patch.enabled === 'boolean') entry.enabled = patch.enabled
      if (typeof patch.exhausted === 'boolean') entry.exhausted = patch.exhausted
      if (Array.isArray(patch.ineligiblePlans) || patch.ineligiblePlans instanceof Set) {
        const list = [...patch.ineligiblePlans].map((x) => String(x)).filter(Boolean)
        entry.ineligiblePlans = new Set(list)
      }
      const saved = persisted[entry.id] ?? {}
      if (typeof patch.enabled === 'boolean') saved.enabled = patch.enabled
      if (typeof patch.exhausted === 'boolean') saved.exhausted = patch.exhausted
      if (Array.isArray(patch.ineligiblePlans) || patch.ineligiblePlans instanceof Set) {
        saved.ineligiblePlans = [...entry.ineligiblePlans]
      }
      persisted[entry.id] = saved
    }

    try {
      writePersistedState(persisted)
    } catch {
      /* 持久化失败不影响本次会话。 */
    }
    return true
  }

  /**
   * 模型通道：account-state 的手动选择优先于配置默认（面板开关直接改这里）。
   * @param {{ channelMode?: string }} [config]
   * @returns {'cli' | 'direct'}
   */
  getChannelMode(config) {
    const persisted = readPersistedState()
    const mode = persisted.__channelMode
    if (mode === 'cli' || mode === 'direct') return mode
    return config?.channelMode === 'direct' ? 'direct' : 'cli'
  }

  /**
   * 手动切换模型通道（选择哪个就用哪个，不做跨通道自动回退）。
   * @param {string} mode
   * @returns {'cli' | 'direct'}
   */
  setChannelMode(mode) {
    const m = mode === 'direct' ? 'direct' : 'cli'
    const persisted = readPersistedState()
    persisted.__channelMode = m
    writePersistedState(persisted)
    return m
  }

  /**
   * D3：池加载完成后后台预热主账号的 app-server 子进程。
   * 首条消息的 TTFT 可省 3-8s（spawn + startup/storageState 就绪）。
   * 不阻塞、不抛错、失败只记日志——预热失败时首个回合照常现场拉起。
   * @returns {void}
   */
  preheat() {
    try {
      const entry = this.pick() ?? this.list().find((e) => e.account !== null)
      if (!entry || entry.account === null) return
      const client = this.clientFor(entry)
      void client.ensureStarted().catch((e) => {
        this.logger.warn?.(`[dx-zcode] 预热「${entry.label}」app-server 失败（首个回合会现场重试）：${e instanceof Error ? e.message : String(e)}`)
      })
    } catch {
      /* 预热失败不影响主流程。 */
    }
  }

  /** 关闭全部子进程。@returns {void} */
  dispose() {    for (const entry of this.entries.values()) {
      try {
        entry.client?.dispose()
      } catch {
        /* 已退出。 */
      }
      entry.client = null
    }
  }
}

/**
 * 从 Z·SWITCH 账号库推出候选数据根。
 *
 * Z·SWITCH 把每个账号存成 `<root>/accounts/<id>/`，其中的 ZCode 数据根
 * 若存在 `.zcode/v2/credentials.json` 就直接可用。找不到就返回空，
 * 由上层退回「本机当前登录」。
 * @param {any} opts
 * @returns {string[]}
 */
function zswitchRoots(opts) {
  /** @type {string[]} */
  const out = []
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  /** @type {string[]} */
  const bases = []
  if (typeof opts.zswitchDataRoot === 'string' && opts.zswitchDataRoot.trim() !== '') bases.push(opts.zswitchDataRoot.trim())
  if (home !== '') {
    bases.push(path.join(home, '.zcode-switch'))
    bases.push(path.join(process.env.LOCALAPPDATA ?? home, 'zcode-switch'))
  }
  for (const base of bases) {
    for (const candidate of [path.join(base, 'accounts'), base]) {
      let names = []
      try {
        names = fs.readdirSync(candidate, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      } catch {
        continue
      }
      for (const name of names) {
        const dir = path.join(candidate, name)
        if (fs.existsSync(path.join(dir, '.zcode', 'v2', 'credentials.json'))) out.push(dir)
      }
    }
  }
  return out
}

/** 供诊断：CLI 与数据根的可读事实。@param {any} opts */
export function environmentFacts(opts) {
  /** @type {any} */
  const facts = { node: process.version, platform: `${process.platform}/${process.arch}` }
  try {
    const cli = locateCli(opts.zcodeCliPath ?? '')
    facts.cli = { path: cli.path, version: cli.version, hasBuiltinProvider: cli.hasBuiltin }
  } catch (e) {
    facts.cli = { error: e instanceof Error ? e.message : String(e) }
  }
  try {
    facts.dataBaseDir = resolveDataBaseDir(opts.zcodeDataBaseDir ?? '')
  } catch (e) {
    facts.dataBaseDir = { error: e instanceof Error ? e.message : String(e) }
  }
  return facts
}
