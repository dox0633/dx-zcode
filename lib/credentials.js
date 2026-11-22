/**
 * ZCode 凭证读取层。
 *
 * 支持两种信封格式（均为 AES-256-GCM）：
 *   - `enc:v1:<iv>.<tag>.<data>`        旧版，密钥由本机信息确定性派生
 *   - `enc:v2:<os|env>:<fp>:<iv>.<tag>.<data>`  3.18 起的系统凭据库版本
 *
 * `enc:v2:os` 的 32 字节密钥存于操作系统凭据库：
 *   service = "ZCode Credential Encryption"
 *   user    = sha256(credentials.json 绝对路径) 的 hex
 * 我们通过 ZCode 客户端自带的 @napi-rs/keyring 原生绑定读取，
 * 不复制、不写入、不重置原始条目。
 *
 * 所有函数都只读；任何失败都抛出带 code 的错误，便于上层给出可操作提示。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, createDecipheriv, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'

/** @param {string} code @param {string} message */
function err(code, message) {
  const e = /** @type {Error & { code: string }} */ (new Error(message))
  e.code = code
  return e
}

// ── CLI / 客户端定位 ──────────────────────────────────────────────────────────

/** 桌面客户端在固定盘符根目录（安装器允许任意盘）。@returns {string[]} */
function desktopDriveCandidates() {
  if (process.platform !== 'win32') return []
  /** @type {string[]} */
  const out = []
  for (let c = 0x44; c <= 0x5a; c++) out.push(`${String.fromCharCode(c)}:\\ZCode\\resources\\glm\\zcode.cjs`)
  return out
}

/**
 * zcode.cjs 候选路径。npm 版优先（只有它带 provider/zcode-builtin.json），
 * 其次桌面端自带内核。
 * @type {readonly string[]}
 */
export const CLI_CANDIDATES = [
  process.env.ZCODE_CLI_PATH,
  ...npmGlobalCandidates(),
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs') : undefined,
  process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'ZCode', 'resources', 'glm', 'zcode.cjs') : undefined,
  ...desktopDriveCandidates(),
  '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
  '/opt/ZCode/resources/glm/zcode.cjs',
].filter((v) => typeof v === 'string' && v !== '')

/** 从 PATH 上的 npm 前缀找 zcode-app-cli 的 vendor/zcode.cjs。@returns {string[]} */
function npmGlobalCandidates() {
  /** @type {string[]} */
  const out = []
  const name = process.platform === 'win32' ? 'zcode.cmd' : 'zcode'
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    try {
      if (!fs.existsSync(path.join(dir, name))) continue
    } catch {
      continue
    }
    // <prefix>/zcode[.cmd] -> <prefix>/node_modules/zcode-app-cli/vendor/zcode.cjs
    out.push(path.join(dir, 'node_modules', 'zcode-app-cli', 'vendor', 'zcode.cjs'))
    out.push(path.join(dir, '..', 'node_modules', 'zcode-app-cli', 'vendor', 'zcode.cjs'))
  }
  return out
}

/** 已定位 CLI 的持久化记录：安装器/运行时成功发现后落盘，供受限环境的运行时直接命中。 */
const CLI_PERSIST_FILE = path.join(
  process.env.DSH_WELFARE_BASE ?? path.join(os.homedir(), '.dsh', 'dx-zcode'),
  'cli-path.json',
)

/** @returns {string} 持久化的 CLI 路径（文件缺失或路径已失效时返回空串）。 */
function persistedCliCandidate() {
  try {
    const raw = JSON.parse(fs.readFileSync(CLI_PERSIST_FILE, 'utf8'))
    const p = typeof raw?.path === 'string' ? raw.path : ''
    return p !== '' && fs.existsSync(p) ? p : ''
  } catch {
    return ''
  }
}

/** @param {string} cliPath @returns {void} */
function persistCliPath(cliPath) {
  try {
    fs.mkdirSync(path.dirname(CLI_PERSIST_FILE), { recursive: true })
    fs.writeFileSync(CLI_PERSIST_FILE, JSON.stringify({ path: cliPath, at: Date.now() }))
  } catch {
    /* 持久化失败只影响受限环境下的下次发现，不影响本次。 */
  }
}

/** 本插件受管凭据密钥文件（登录走 CLI env 模式时的密钥来源）。 */
function managedSecretFile() {
  return path.join(
    process.env.DSH_WELFARE_BASE ?? path.join(os.homedir(), '.dsh', 'dx-zcode'),
    'credential-secret',
  )
}

/**
 * 确保受管密钥文件存在（32–4096 字节），返回其路径。幂等。
 * @returns {string}
 */
export function ensureManagedSecret() {
  const file = managedSecretFile()
  try {
    const stat = fs.statSync(file)
    if (stat.isFile() && stat.size >= 32 && stat.size <= 4096) return file
  } catch {
    /* 不存在 → 创建。 */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, randomBytes(48).toString('hex') + '\n', { mode: 0o600 })
  return file
}

/**
 * 定位最适合执行 CLI 的原生 Node 二进制文件。
 * 优先使用真正的 node.exe（如 DSH 自带依赖或系统 node），
 * 绝不能直接把 DSH / Electron 宿主当作 node.exe 调起，否则其子进程会
 * 级联伪装为宿主主进程，触发锁争用、多开风暴与界面重连断连。
 * @returns {string}
 */
export function resolveNodeBinary() {
  const home = os.homedir()
  const candidates = [
    process.env.ZCODE_NODE_PATH,
    // C6：DSH 运行时实际位置（junction 下）优先于机器特化硬编码路径
    path.join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    'C:\\Program Files\\DSH Desktop\\resources\\runtime\\primary-runtime\\dependencies\\node\\bin\\node.exe',
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  try {
    const { execSync } = createRequire(import.meta.url)('node:child_process')
    const out = execSync(process.platform === 'win32' ? 'where.exe node' : 'which node', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0]
    if (out && fs.existsSync(out)) return out
  } catch {}

  return process.execPath
}

/** locateCli 结果缓存（C7）：免每次扫描 D:-Z: 共 23 个 statSync；60s TTL + 路径存在性校验。 */
let cliCache = null

/**
 * 选出一个可用的 CLI 内核。
 *
 * 优先级：显式配置 > 持久化记录（受限环境如 DSH 运行时的可靠命中）>
 * 带 `provider/zcode-builtin.json` 的（npm 完整包）> 版本更高者。
 * 桌面端内核没有 provider 目录，`app-server` 起不来，因此排在其后。
 * @param {string} [explicit] 配置里显式指定的路径。
 * @returns {{ path: string, version: string, hasBuiltin: boolean, root: string }}
 */
export function locateCli(explicit = '') {
  const want = explicit.trim()
  if (cliCache !== null && cliCache.key === want && Date.now() - cliCache.at < 60000
      && fs.existsSync(cliCache.result.path)) {
    return cliCache.result
  }
  const persisted = want === '' ? persistedCliCandidate() : ''
  const list = want !== ''
    ? [want, ...CLI_CANDIDATES]
    : [persisted, ...CLI_CANDIDATES].filter((v) => typeof v === 'string' && v !== '')
  /** @type {Array<{path:string,version:string,hasBuiltin:boolean,root:string}>} */
  const found = []
  for (const file of new Set(list)) {
    try {
      if (!fs.statSync(file).isFile()) continue
    } catch {
      continue
    }
    const root = path.dirname(file)
    found.push({
      path: file,
      version: readCliVersion(file),
      hasBuiltin: fs.existsSync(path.join(root, 'provider', 'zcode-builtin.json')),
      root,
    })
  }
  if (found.length === 0) {
    throw err('CLI_NOT_FOUND', '没找到 ZCode CLI（zcode.cjs）。请安装 ZCode 桌面端，或 npm i -g zcode-app-cli，或在设置里填写 zcodeCliPath。')
  }
  const builtin = found.filter((f) => f.hasBuiltin)
  const pool = builtin.length > 0 ? builtin : found
  pool.sort((a, b) => compareVersion(b.version, a.version))
  const winner = pool[0]
  // 只持久化带 builtin 的 npm 完整包 —— 桌面内核起不了 app-server，不钉死它。
  if (winner.hasBuiltin && winner.path !== persisted) persistCliPath(winner.path)
  cliCache = { key: want, at: Date.now(), result: winner }
  return winner
}

/** @param {string} file @returns {string} */
function readCliVersion(file) {
  try {
    const dir = path.dirname(file)
    const meta = path.join(dir, '.node-bundle-meta.json')
    if (fs.existsSync(meta)) {
      const m = JSON.parse(fs.readFileSync(meta, 'utf8'))
      if (typeof m.version === 'string') return m.version
    }
    // 完整包：vendor/../package.json
    const pkg = path.join(dir, '..', 'package.json')
    if (fs.existsSync(pkg)) {
      const p = JSON.parse(fs.readFileSync(pkg, 'utf8'))
      if (typeof p.version === 'string') return p.version
    }
  } catch {
    /* 版本只用于排序，读不到就退化。 */
  }
  return '0.0.0'
}

/** @param {string} a @param {string} b @returns {number} */
function compareVersion(a, b) {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

// ── 数据根目录 ────────────────────────────────────────────────────────────────

/**
 * ZCode 数据根目录（其下有 `.zcode/v2/credentials.json`）。
 *
 * 桌面端允许把 dataBaseDir 改到任意位置，
 * 所以先读 `~/.zcode/v2/setting.json` 的 dataBaseDir，再退回默认家目录。
 * @param {string} [explicit]
 * @returns {string}
 */
export function resolveDataBaseDir(explicit = '') {
  const want = explicit.trim()
  if (want !== '') return path.resolve(want)
  const home = os.homedir()
  for (const settingFile of [path.join(home, '.zcode', 'v2', 'setting.json'), path.join(home, '.zcode', 'cli', 'config.json')]) {
    try {
      const s = JSON.parse(fs.readFileSync(settingFile, 'utf8'))
      if (typeof s.dataBaseDir === 'string' && path.isAbsolute(s.dataBaseDir)) return s.dataBaseDir
    } catch {
      /* 下一个候选。 */
    }
  }
  return home
}

/**
 * 凭证文件位置。
 * @param {string} dataBaseDir
 * @returns {{ credentials: string, telemetry: string, credentialSource: string, setting: string }}
 */
export function credentialPaths(dataBaseDir) {
  const base = path.join(dataBaseDir, '.zcode', 'v2')
  return {
    credentials: path.join(base, 'credentials.json'),
    telemetry: path.join(base, 'telemetry-state.json'),
    credentialSource: path.join(base, 'credential-source'),
    setting: path.join(base, 'setting.json'),
  }
}

// ── keyring ───────────────────────────────────────────────────────────────────

/** @type {any} */
let keyringCache = null

/**
 * 加载 CLI 本地 node_modules 自带的 @napi-rs/keyring 原生绑定。
 *
 * 绝对不扫描、不加载外部桌面端（如 C:\Program Files\ZCode）中的动态库，
 * 防止跨进程持有 DLL 句柄导致外部程序升级失败（win32-error=80）。
 * @param {string} cliPath
 * @returns {any | null}
 */
export function loadKeyring(cliPath) {
  if (keyringCache !== null) return keyringCache
  const dir = path.dirname(cliPath)
  const directory = dir
  /** @type {string[]} */
  const roots = [
    // 仅使用 CLI 自身安装目录的 node_modules 中的原生绑定（例如 npm 全局安装包）
    path.join(dir, '..', 'node_modules', '@napi-rs'),
    path.join(dir, 'node_modules', '@napi-rs'),
  ]
  const req = createRequire(path.join(directory, 'noop.js'))
  for (const root of roots) {
    try {
      if (!fs.statSync(root).isDirectory()) continue
    } catch {
      continue
    }
    let pkgs = []
    try {
      pkgs = fs.readdirSync(root).filter((n) => n.startsWith(`keyring-${process.platform}-`))
    } catch {
      continue
    }
    for (const pkg of pkgs) {
      const pkgDir = path.join(root, pkg)
      let files = []
      try {
        files = fs.readdirSync(pkgDir).filter((n) => n.endsWith('.node'))
      } catch {
        continue
      }
      for (const file of files) {
        try {
          const mod = req(path.join(pkgDir, file))
          if (typeof mod?.Entry === 'function') {
            keyringCache = mod
            return keyringCache
          }
        } catch {
          /* 架构不匹配不是权限回退。 */
        }
      }
    }
  }

  keyringCache = null
  return keyringCache
}

/**
 * 清空 keyring 探测缓存（配置变更或诊断用）。
 * @returns {void}
 */
export function resetKeyringCache() {
  keyringCache = null
}

/**
 * 读取 OS 凭据库里的 v2 密钥（base64url，43 字符）。
 * @param {string} cliPath
 * @param {string} credentialsFile
 * @returns {string}
 */
function readOsSecret(cliPath, credentialsFile) {
  const keyring = loadKeyring(cliPath)
  if (keyring === null) {
    throw err('KEYRING_UNAVAILABLE', '读不到系统凭据库组件（@napi-rs/keyring）。请确认 ZCode 桌面端完整安装。')
  }
  const account = createHash('sha256').update(path.resolve(credentialsFile)).digest('hex')
  try {
    const value = new keyring.Entry('ZCode Credential Encryption', account, { linux: { store: 'secret-service' } }).getPassword()
    if (typeof value === 'string' && value !== '') return value
  } catch {
    /* 统一抛出可操作提示。 */
  }
  throw err('KEYRING_ENTRY_MISSING', '系统凭据库中没有 ZCode 加密密钥。请打开一次 ZCode 客户端并保持登录。')
}

/**
 * 解密单个信封值。
 * @param {string} envelope
 * @param {{ cliPath: string, credentialsFile: string, dataBaseDir: string }} env
 * @returns {string}
 */
export function decryptValue(envelope, env) {
  const value = String(envelope)
  if (!value.startsWith('enc:')) return value

  let key
  let rest
  if (value.startsWith('enc:v2:')) {
    rest = value.slice('enc:v2:'.length)
    const fields = rest.split(':')
    if (fields.length < 3) throw err('CREDENTIAL_FORMAT', '凭据格式不正确（enc:v2）。')
    const [source, fingerprint] = fields
    rest = fields.slice(2).join(':')
    if (source === 'env') {
      // 密钥候选按**指纹匹配**挑选（主根/影子根/受管密钥并存，谁指纹对上用谁）：
      // 显式环境变量 → ZCODE_CREDENTIAL_SECRET_FILE → 凭据目录旁的
      // credential-secret → 本插件受管密钥文件（登录走 env 模式时写的就是它）。
      if (process.env.ZCODE_CREDENTIAL_SECRET) {
        key = createHash('sha256').update(process.env.ZCODE_CREDENTIAL_SECRET).digest()
        const actual = createHash('sha256').update(key).digest('hex').slice(0, 24)
        if (actual !== fingerprint) {
          throw err('CREDENTIAL_KEYSTORE', 'ZCODE_CREDENTIAL_SECRET 与凭据指纹不匹配。')
        }
      } else {
        const candidates = [
          process.env.ZCODE_CREDENTIAL_SECRET_FILE,
          path.join(path.dirname(env.credentialsFile), 'credential-secret'),
          managedSecretFile(),
        ].filter((v) => typeof v === 'string' && v !== '')
        let matched = false
        for (const secretFile of candidates) {
          try {
            const stat = fs.statSync(secretFile)
            if (!stat.isFile() || stat.size < 32 || stat.size > 4096) continue
            const candidateKey = createHash('sha256').update(fs.readFileSync(secretFile, 'utf8')).digest()
            const actual = createHash('sha256').update(candidateKey).digest('hex').slice(0, 24)
            if (actual !== fingerprint) continue
            key = candidateKey
            matched = true
            break
          } catch {
            /* 下一个候选。 */
          }
        }
        if (!matched) {
          throw err('CREDENTIAL_SECRET_MISSING', `该凭据使用 env 模式，但 ${candidates.length} 处候选密钥都读不到或指纹不符。请重新登录。`)
        }
      }
    } else if (source === 'os') {
      key = Buffer.from(readOsSecret(env.cliPath, env.credentialsFile), 'base64url')
      const actual = createHash('sha256').update(key).digest('hex').slice(0, 24)
      if (actual !== fingerprint) {
        throw err('CREDENTIAL_KEYSTORE', '系统凭据库中的密钥与凭据指纹不匹配（可能已被重置）。请重新登录 ZCode。')
      }
    } else {
      throw err('CREDENTIAL_FORMAT', `未知的凭据来源：${source}`)
    }
  } else if (value.startsWith('enc:v1:')) {
    rest = value.slice('enc:v1:'.length)
    key = legacyKey(env.dataBaseDir)
  } else {
    throw err('CREDENTIAL_FORMAT', '未知的凭据版本前缀。')
  }

  const parts = rest.split('.')
  if (parts.length !== 3) throw err('CREDENTIAL_FORMAT', '凭据密文段数不正确。')
  const [ivB64, tagB64, dataB64] = parts
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw err('CREDENTIAL_DECRYPT', '凭据解密失败。请重新登录 ZCode 客户端。')
  }
}

/**
 * enc:v1 的派生密钥：sha256(固定盐 + 平台 + 家目录 + 用户名)。
 * 早期版本只用混淆，不接系统凭据库。
 * @param {string} dataBaseDir
 * @returns {Buffer}
 */
function legacyKey(dataBaseDir) {
  const override = process.env.ZCODE_CREDENTIAL_SECRET
  if (override) return createHash('sha256').update(override).digest()
  const seed = `zcode-credential-v1:${process.platform}:${dataBaseDir}:${os.userInfo().username}`
  return createHash('sha256').update(seed).digest()
}

// ── 账号快照 ──────────────────────────────────────────────────────────────────

/**
 * @typedef {object} ZcodeAccount
 * @property {string} id 稳定标识（取自 JWT 的 sub/iat 哈希）。
 * @property {string} planToken `zcodejwttoken`（plan JWT）。
 * @property {string} deviceMid `telemetry-state.json` 的 deviceMid。
 * @property {string} provider 登录家族：zai / bigmodel / unknown。
 * @property {string} userName 显示名（best effort）。
 * @property {number} issuedAt JWT iat。
 * @property {string} dataBaseDir 数据根。
 * @property {string} credentialsFile 凭证文件路径。
 * @property {string} cliPath 使用的 CLI。
 * @property {string} cliVersion CLI 版本。
 */

/**
 * 读取一个数据根下的全部账号信息。
 *
 * 注意：一个 `credentials.json` 只对应一个「当前登录」账号。
 * 多账号靠 Z·SWITCH 账号库或外部快照目录提供多份数据根。
 * @param {{ dataBaseDir?: string, cliPath?: string }} [options]
 * @returns {ZcodeAccount}
 */
export function readAccount(options = {}) {
  const cli = locateCli(options.cliPath ?? '')
  const dataBaseDir = resolveDataBaseDir(options.dataBaseDir ?? '')
  const paths = credentialPaths(dataBaseDir)
  if (!fs.existsSync(paths.credentials)) {
    throw err('CREDENTIALS_MISSING', `没找到凭据文件：${paths.credentials}\n请先登录 ZCode 客户端。`)
  }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(paths.credentials, 'utf8'))
  } catch {
    throw err('CREDENTIALS_UNREADABLE', '凭据文件不是合法 JSON。')
  }
  const envelope = raw['zcodejwttoken']
  if (typeof envelope !== 'string' || envelope === '') {
    throw err('NOT_LOGGED_IN', '凭据文件中没有 zcodejwttoken，请先在 ZCode 客户端完成登录。')
  }
  const planToken = decryptValue(envelope, { cliPath: cli.path, credentialsFile: paths.credentials, dataBaseDir })
  if (planToken.split('.').length !== 3) {
    throw err('TOKEN_FORMAT', 'zcodejwttoken 不是合法的 JWT。')
  }

  let deviceMid = ''
  try {
    const t = JSON.parse(fs.readFileSync(paths.telemetry, 'utf8'))
    if (typeof t.deviceMid === 'string') deviceMid = t.deviceMid.trim()
  } catch {
    /* 下面统一报错。 */
  }
  if (!/^[\x21-\x7e]{1,256}$/.test(deviceMid)) {
    throw err('DEVICE_MID_MISSING', '缺少设备标识（telemetry-state.json 的 deviceMid）。请打开一次 ZCode 客户端。')
  }

  let provider = 'unknown'
  let userName = ''
  let userEmail = ''
  let userAvatar = ''
  let userId = ''
  try {
    const p = decryptValue(String(raw['oauth:active_provider'] ?? ''), { cliPath: cli.path, credentialsFile: paths.credentials, dataBaseDir })
    // 三个合法值：zai（国际站）/ zai_cn（国内站）/ bigmodel。
    // 之前只白名单了前两个，把国内站误判成 unknown，
    // 连带影子通道也不会触发。
    if (p === 'zai' || p === 'zai_cn' || p === 'bigmodel') provider = p
  } catch {
    /* 非关键；下面还有兜底推断。 */
  }
  // 解密真实用户信息（昵称/手机号/邮箱/头像）
  for (const candidate of ['zai_cn', 'zai', 'bigmodel']) {
    const key = `oauth:${candidate}:user_info`
    if (typeof raw[key] === 'string' && raw[key] !== '') {
      try {
        const infoStr = decryptValue(raw[key], { cliPath: cli.path, credentialsFile: paths.credentials, dataBaseDir })
        const info = JSON.parse(infoStr)
        if (info && typeof info === 'object') {
          const profile = (info.rawProfile && typeof info.rawProfile === 'object') ? info.rawProfile : {}
          const name = info.displayName || info.name || info.username || profile.name || ''
          const email = info.email || profile.email || ''
          const uid = info.user_id || profile.user_id || ''
          const avatar = info.avatar || profile.avatar || ''
          if (name && !userName) userName = name
          if (email && !userEmail) userEmail = email
          if (uid && !userId) userId = String(uid)
          if (avatar && !userAvatar) userAvatar = avatar
        }
        if (provider === 'unknown') provider = candidate
        if (userName) break
      } catch {
        /* 解密失败忽略 */
      }
    }
  }
  const payload = jwtPayload(planToken)
  if (!userId && (payload?.user_id || payload?.sub)) {
    userId = String(payload.user_id || payload.sub)
  }
  if (!userName && userEmail) {
    userName = userEmail.includes('@phone.local') ? userEmail.replace('@phone.local', '') : userEmail
  }
  const issuedAt = Number(payload?.iat ?? 0) || 0
  const subject = String(payload?.sub ?? payload?.user_id ?? userId ?? '')

  return {
    id: accountId(subject, issuedAt),
    planToken,
    deviceMid,
    provider,
    userName,
    userEmail,
    userAvatar,
    userId,
    issuedAt,
    dataBaseDir,
    credentialsFile: paths.credentials,
    cliPath: cli.path,
    cliVersion: cli.version,
  }
}

/** @param {string} token @returns {any} */
export function jwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/** @param {string} subject @param {number} issuedAt @returns {string} */
export function accountId(subject, issuedAt) {
  return 'zc-' + createHash('sha256').update(`${subject}:${issuedAt}`).digest('hex').slice(0, 12)
}

/** 供诊断使用：不泄露 token。@param {ZcodeAccount} account */
export function describeAccount(account) {
  return {
    id: account.id,
    provider: account.provider,
    userName: account.userName,
    userEmail: account.userEmail,
    userAvatar: account.userAvatar,
    userId: account.userId,
    issuedAt: account.issuedAt,
    dataBaseDir: account.dataBaseDir,
    cliPath: account.cliPath,
    cliVersion: account.cliVersion,
  }
}
