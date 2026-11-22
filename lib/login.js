/**
 * 双站 OAuth 登录。
 *
 * 官方 CLI 自带 `login [zai|bigmodel]` 子命令：
 *   - `zai`      国际站（z.ai）
 *   - `bigmodel` 国内站（bigmodel.cn）
 * 它会打开系统浏览器完成授权，授权后把凭据写回 ZCode 数据根。
 *
 * 本模块只负责调起它并等待结果，不复刻授权流程 —— 那是官方客户端的职责，
 * 复刻既不可靠也会引入新的风控特征。
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureManagedSecret, readAccount, resolveNodeBinary } from './credentials.js'
import { readPersistedState, writePersistedState } from './state-store.js'

/**
 * 临时登录暂存数据根：每次授权创建独立的临时目录，授权成功后按账号 id 独立归档到 accounts/ 目录。
 * 绝不再共用单一的 login-root，彻底解决「添加新账号覆盖前一个账号」的严重 Bug。
 * @returns {string}
 */
export function prepareLoginRoot() {
  const base = process.env.DSH_WELFARE_BASE ?? path.join(process.env.USERPROFILE ?? process.env.HOME, '.dsh', 'dx-zcode')
  const stagingId = 'staging-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  const root = path.join(base, 'staging', stagingId)
  const v2 = path.join(root, '.zcode', 'v2')
  fs.mkdirSync(v2, { recursive: true })
  fs.writeFileSync(path.join(v2, 'credential-source'), 'env\n', { mode: 0o600 })
  fs.writeFileSync(path.join(v2, 'telemetry-state.json'), JSON.stringify({ deviceMid: randomUUID() }), { mode: 0o600 })
  const secretFile = ensureManagedSecret()
  if (fs.existsSync(secretFile)) {
    try { fs.copyFileSync(secretFile, path.join(v2, 'credential-secret')) } catch {}
  }
  return root
}

/** @param {string} code @param {string} message */
function lerr(code, message) {
  const e = /** @type {Error & { code: string }} */ (new Error(message))
  e.code = code
  return e
}

/** 站点 → CLI 子命令。
 * 国际站：login zai（跳转 z.ai 授权页）
 * 国内站：login bigmodel（跳转 bigmodel.cn 智谱开放平台授权页）
 */
const PROVIDER_ARG = {
  zai: 'zai',
  zai_cn: 'bigmodel',
  bigmodel: 'bigmodel',
}

/**
 * 跑一次登录。
 *
 * 注意：`zai` 与 `zai_cn` 都走同一个 `login zai` 子命令 —— 官方 CLI 在
 * 授权页里让你选站点，`oauth:active_provider` 会写成 `zai` 或 `zai_cn`。
 * 我们保留两个入口只是为了在 UI 上说清楚。
 *
 * @param {{ cliPath: string, dataBaseDir: string, provider: string, logger?: any, timeoutMs?: number }} options
 * @returns {Promise<{ ok: boolean, provider: string, message: string }>}
 */
export function loginWithCli(options) {
  const logger = options.logger ?? console
  const arg = PROVIDER_ARG[options.provider]
  if (arg === undefined) throw lerr('PROVIDER_INVALID', `不支持的登录站点：${options.provider}`)

  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    // 登录目标：受管登录根（env 模式）。调用方传入的 dataBaseDir 仅在显式
    // 要求时使用 —— 默认不写桌面数据根。
    const targetRoot = options.useManagedRoot === false && options.dataBaseDir
      ? options.dataBaseDir
      : prepareLoginRoot()
    env.ZCODE_DATA_BASE_DIR = targetRoot
    const builtin = path.join(path.dirname(options.cliPath), 'provider', 'zcode-builtin.json')
    if (path.isAbsolute(builtin) && builtin !== '') {
      // 只有带 builtin 的内核才能解析账号通道；登录本身不依赖它，
      // 但带上可以让登录后的通道立即可用。
      env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtin
    }
    // 凭据写入走 CLI 的 env 受管密钥模式（System credential storage 在部分
    // 宿主环境下不可用；CLI 报错原文就指向这两个变量）。两路受管源互斥，
    // 显式清掉 ZCODE_CREDENTIAL_SECRET 只留 SECRET_FILE。
    const secretFile = ensureManagedSecret()
    env.ZCODE_CREDENTIAL_SECRET_FILE = secretFile
    delete env.ZCODE_CREDENTIAL_SECRET
    logger.info?.(`[dx-zcode] 调起登录：zcode login ${arg}（凭据 env 模式，密钥 ${secretFile}）`)

    const nodeExecutable = options.cliNode || resolveNodeBinary()
    if (nodeExecutable === process.execPath || String(nodeExecutable).toLowerCase().includes('deepseek harness') || String(nodeExecutable).toLowerCase().includes('electron')) {
      env.ELECTRON_RUN_AS_NODE = '1'
    }
    const child = spawn(nodeExecutable, [options.cliPath, 'login', arg], {
      cwd: path.dirname(options.cliPath),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    /** @type {string[]} */
    const out = []
    /** @type {string[]} */
    const err = []
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (c) => out.push(String(c)))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (c) => err.push(String(c)))

    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* 已退出。 */
      }
      reject(lerr('LOGIN_TIMEOUT', `登录超时（${Math.round((options.timeoutMs ?? 300000) / 1000)} 秒）。请在浏览器完成授权后重试。`))
    }, options.timeoutMs ?? 300000)

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(lerr('LOGIN_SPAWN', `无法启动登录：${error.message}`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      const text = [...out, ...err].join('\n').trim()
      if (code === 0) {
        try {
          const acc = readAccount({ dataBaseDir: targetRoot, cliPath: options.cliPath })
          if (acc && acc.id) {
            const base = process.env.DSH_WELFARE_BASE ?? path.join(process.env.USERPROFILE ?? process.env.HOME, '.dsh', 'dx-zcode')
            const accountsDir = path.join(base, 'accounts')
            const destDir = path.join(accountsDir, acc.id)
            const destV2 = path.join(destDir, '.zcode', 'v2')
            fs.mkdirSync(destV2, { recursive: true })
            const srcV2 = path.join(targetRoot, '.zcode', 'v2')
            if (fs.existsSync(srcV2)) {
              for (const file of fs.readdirSync(srcV2)) {
                const s = path.join(srcV2, file)
                const d = path.join(destV2, file)
                if (fs.statSync(s).isFile()) fs.copyFileSync(s, d)
              }
            }
            // 统一走 state-store（内存缓存 + 原子落盘），不再直写文件绕过 pool 的缓存视图
            try {
              const persisted = readPersistedState()
              if (persisted[acc.id]?.removed) {
                delete persisted[acc.id].removed
                persisted[acc.id].enabled = true
                writePersistedState(persisted)
              }
            } catch {}
            logger.info?.(`[dx-zcode] 新账号已独立归档：${acc.userName || acc.id} -> ${destDir}`)
          }
        } catch (saveErr) {
          logger.warn?.(`[dx-zcode] 归档新账号目录失败：${saveErr instanceof Error ? saveErr.message : String(saveErr)}`)
        } finally {
          if (targetRoot.includes('staging')) {
            try { fs.rmSync(targetRoot, { recursive: true, force: true }) } catch {}
          }
        }
        resolve({ ok: true, provider: options.provider, message: text === '' ? '登录完成' : text.slice(0, 400) })
      } else {
        if (targetRoot.includes('staging')) {
          try { fs.rmSync(targetRoot, { recursive: true, force: true }) } catch {}
        }
        reject(lerr('LOGIN_FAILED', `登录未完成（退出码 ${code ?? '-'}）${text === '' ? '' : '：' + text.slice(0, 300)}`))
      }
    })
  })
}
