/**
 * 账号通道注入层 —— 本插件最核心的补丁。
 *
 * ── 问题（ZCode 3.18.2 逐行验证） ────────────────────────────────────────
 *
 * CLI 的 standalone 账号解析里有一处不对称：
 *
 *   // 认国内站
 *   const ZAI_CN = 'zai_cn'
 *   isZaiOAuthProvider = e => e === 'zai' || e === ZAI_CN
 *
 *   // 但 start-plan 分支只接受两个字面量
 *   readStartPlanSession: family = active['oauth:active_provider']
 *                         if (family !== 'zai' && family !== 'bigmodel') return undefined
 *
 * 国内站登录写入的正是 `zai_cn`，所以 start-plan 会话被判为不存在，
 * `account:zai-start-plan` 永远不进 provider registry，
 * `session/create` 的模型目录里根本没有 z.ai 账号通道。
 *
 * 这就是「订阅有额度、插件反代不出来」的确切断点。
 *
 * ── 解法（不改上游任何文件） ──────────────────────────────────────────────
 *
 * 造一个**隔离影子数据根**，把 `oauth:active_provider` 改写为 `zai`，
 * 让 CLI 通过 `ZCODE_DATA_BASE_DIR` 指向它。原桌面目录一字不动。
 *
 * 影子目录的凭据用 CLI 支持的 **env 模式**重封：
 *
 *   密钥 K = sha256(ZCODE_CREDENTIAL_SECRET)         （CLI 的 fka/mka 实现）
 *   信封   = "enc:v2:env:" + sha256(K).hex[0:24] + ":" + iv.b64url + "." + tag.b64url + "." + ct.b64url
 * 算法 AES-256-GCM，iv 12 字节，tag 16 字节。
 *
 * 这样影子目录完全不依赖系统凭据库，也就避开了
 * 「OS 密钥按 credentials.json 绝对路径索引」这个复制障碍。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomBytes, createCipheriv } from 'node:crypto'

/** 国内站 provider 常量（CLI 内部 Rct）。 */
export const ZAI_CN = 'zai_cn'
/** CLI start-plan 分支唯一接受的两个值。 */
export const ACCEPTED_FAMILIES = new Set(['zai', 'bigmodel'])

/** IV 长度（字节）。 */
const IV_BYTES = 12

/**
 * 影子数据根位置（按源目录哈希隔离，支持多账号）。
 * @param {string} dataBaseDir
 * @returns {string}
 */
export function shadowRoot(dataBaseDir) {
  const tag = createHash('sha256').update(path.resolve(dataBaseDir)).digest('hex').slice(0, 16)
  return path.join(os.homedir(), '.dsh', 'dx-zcode', 'shadow', tag)
}

/**
 * 按 CLI 的算法派生密钥。
 * @param {string} secret
 * @returns {Buffer}
 */
export function deriveKey(secret) {
  return createHash('sha256').update(secret).digest()
}

/**
 * 用 env 模式重封一个明文值。
 * @param {string} plain
 * @param {Buffer} key
 * @returns {string}
 */
export function sealEnv(plain, key) {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const fingerprint = createHash('sha256').update(key).digest('hex').slice(0, 24)
  const parts = [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64url')).join('.')
  return `enc:v2:env:${fingerprint}:${parts}`
}

/**
 * 准备影子数据根。
 *
 * @param {{
 *   dataBaseDir: string,
 *   secrets: Record<string, string>,
 *   forceFamily?: string,
 *   logger?: any,
 * }} options
 * @returns {{ root: string, family: string, rewritten: boolean, files: number }}
 */
export function prepareShadow(options) {
  const logger = options.logger ?? console
  const source = path.join(options.dataBaseDir, '.zcode')
  const root = shadowRoot(options.dataBaseDir)
  const target = path.join(root, '.zcode')

  fs.mkdirSync(path.join(target, 'v2'), { recursive: true })

  // ① 复制设置 / 设备指纹 / provider 配置（跳过凭据与缓存）
  const files = copyTree(source, target, new Set(['credentials.json', 'credential-source', 'credential-secret']))

  // ② 改写信封
  const family = String(options.secrets['oauth:active_provider'] ?? '')
  const force = options.forceFamily ?? 'zai'
  const rewritten = family !== '' && !ACCEPTED_FAMILIES.has(family)
  const outFamily = rewritten ? force : family

  // CLI 用 `oauth:${family}:user_info` 拼 profile 键：
  //   profileKey = `oauth:${family}:user_info`
  // 所以只改 active_provider 不够 —— 键名也必须跟着迁，
  // 否则 profileIdentity() 拿到 null，start-plan 会话照样被判定不存在。
  /** @type {Record<string, string>} */
  const migrated = {}
  for (const [name, value] of Object.entries(options.secrets)) {
    if (rewritten && name.startsWith(`oauth:${family}:`)) {
      migrated[name.replace(`oauth:${family}:`, `oauth:${outFamily}:`)] = value
      continue
    }
    migrated[name] = value
  }

  const v2 = path.join(target, 'v2')
  const secretFile = path.join(v2, 'credential-secret')
  let secret = ''
  if (fs.existsSync(secretFile)) {
    try {
      const existing = fs.readFileSync(secretFile, 'utf8').trim()
      if (existing.length >= 32 && existing.length <= 4096) {
        secret = existing
      }
    } catch {
      /* 读取失败则重新生成 */
    }
  }
  if (!secret) {
    secret = `${Date.now()}-${randomBytes(16).toString('hex')}-dx-zcode`
  }
  const key = deriveKey(secret)
  /** @type {Record<string, string>} */
  const sealed = {}
  for (const [name, value] of Object.entries(migrated)) {
    if (name === 'oauth:active_provider') {
      sealed[name] = sealEnv(outFamily, key)
      continue
    }
    sealed[name] = sealEnv(value, key)
  }

  fs.writeFileSync(path.join(v2, 'credentials.json'), JSON.stringify(sealed, null, 2), { mode: 0o600 })
  fs.writeFileSync(path.join(v2, 'credential-source'), 'env\n', { mode: 0o600 })
  fs.writeFileSync(secretFile, secret, { mode: 0o600 })

  if (rewritten) {
    logger.info?.(`[dx-zcode] 影子目录：oauth:active_provider ${family} -> ${outFamily}`)
  }

  return { root, family: outFamily, rewritten, files }
}

/**
 * 影子目录是否已经可用（避免每次启动都重建）。
 * @param {string} dataBaseDir
 * @returns {boolean}
 */
export function shadowReady(dataBaseDir) {
  const v2 = path.join(shadowRoot(dataBaseDir), '.zcode', 'v2')
  for (const name of ['credentials.json', 'credential-source', 'credential-secret']) {
    if (!fs.existsSync(path.join(v2, name))) return false
  }
  return true
}

/**
 * 递归复制，跳过凭据文件、密钥文件、大体量缓存目录与会话历史。
 * 文件级增量：目标已存在且不旧于源时跳过 —— 启动路径上只有首次全量，
 * 之后近乎零成本，不再阻塞宿主事件循环拖慢 UI 加载。
 * @param {string} from
 * @param {string} to
 * @param {Set<string>} skip
 * @returns {number} 复制的文件数
 */
function copyTree(from, to, skip) {
  let count = 0
  let entries = []
  try {
    entries = fs.readdirSync(from, { withFileTypes: true })
  } catch {
    return 0
  }
  const skipDirs = new Set([
    'runtime', 'logs', 'log', 'cache', 'node_modules',
    'sessions', 'attachments', 'projects', 'todos', 'telemetry', 'tmp',
  ])
  for (const entry of entries) {
    if (skip.has(entry.name)) continue
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue
      fs.mkdirSync(dst, { recursive: true })
      count += copyTree(src, dst, skip)
      continue
    }
    try {
      // 增量：目标存在且不旧于源 → 跳过
      let stale = true
      try {
        const dstStat = fs.statSync(dst)
        if (dstStat.isFile() && dstStat.mtimeMs >= fs.statSync(src).mtimeMs) stale = false
      } catch {
        /* 目标不存在 → 需要复制 */
      }
      if (!stale) continue
      fs.copyFileSync(src, dst)
      count++
    } catch {
      /* 个别文件被占用不影响主流程。 */
    }
  }
  return count
}
