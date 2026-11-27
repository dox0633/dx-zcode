/**
 * 阿里云无感验证求解器。
 *
 * 背景（实测）：`billing/claim` 与 start-plan 模型通道都需要
 * `X-Aliyun-Captcha-Verify-Param`。无头模式会被判 `F001`，
 * 必须用**带界面**的 Chromium 加 `--disable-blink-features=AutomationControlled`
 * 运行阿里云官方 SDK，才能拿到 200+ 字节的 verifyParam。
 *
 * 求解结果缓存 45 秒（与上游 SDK 的 token 生命周期一致），
 * 并做并发去重：同一时刻只跑一个浏览器实例。
 *
 * 这里用 CDP 直连而不是 puppeteer：宿主不保证装了 puppeteer，
 * 而 Edge / Chrome 一定在。
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { randomUUID } from 'node:crypto'

/** 上游验证码配置（随客户端下发，这里是 3.18.2 的实测值）。 */
export const CAPTCHA_CONFIG = {
  region: 'cn',
  prefix: 'no8xfe',
  sceneId: '11xygtvd',
}

/** 结果缓存 TTL：45 秒。 */
const CACHE_TTL_MS = 45000

/** @type {{ param: string, region: string, at: number } | null} */
let cache = null
/** @type {Promise<{ param: string, region: string }> | null} */
let inflight = null

/**
 * 找一个可用的 Chromium。
 * @returns {string}
 */
export function findBrowser() {
  const candidates = [
    process.env.ZCODE_WELFARE_BROWSER,
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((v) => typeof v === 'string' && v !== '')
  for (const file of candidates) {
    try {
      if (fs.statSync(file).isFile()) return file
    } catch {
      continue
    }
  }
  return ''
}

/**
 * 取得一个 verifyParam（带缓存与并发去重）。
 * @param {{ logger?: any, force?: boolean }} [options]
 * @returns {Promise<{ param: string, region: string }>}
 */
export async function solveCaptcha(options = {}) {
  const logger = options.logger ?? console
  if (!options.force && cache !== null && Date.now() - cache.at < CACHE_TTL_MS) {
    const res = { param: cache.param, region: cache.region }
    if (options.consume) {
      cache = null
    }
    return res
  }
  if (inflight !== null) return inflight
  inflight = runSolver(logger).then((r) => {
    cache = { ...r, at: Date.now() }
    const out = { param: r.param, region: r.region }
    if (options.consume) {
      cache = null
    }
    return out
  }).finally(() => {
    inflight = null
  })
  return inflight
}

/** @returns {{ param: string, region: string } | null} */
export function cachedCaptcha() {
  if (cache === null) return null
  if (Date.now() - cache.at >= CACHE_TTL_MS) return null
  return { param: cache.param, region: cache.region }
}

/**
 * 创建一个可复用的浏览器验证码会话，用于批量领取场景（避免每个账号/活动冷启动 Edge）。
 *
 * 会话仅在首次调用 `solveNext()` 时真正启动浏览器，若本次无需领取则零启动开销。
 * 调用方必须在 `finally` 中调用 `session.close()` 回收浏览器进程。
 *
 * @param {any} [logger]
 * @returns {{ solveNext: () => Promise<{ param: string, region: string }>, close: () => Promise<void> }}
 */
export function createCaptchaSession(logger = console) {
  /** @type {any} */
  let child = null
  /** @type {any} */
  let page = null
  let profile = ''

  const teardown = async () => {
    try {
      page?.close()
    } catch {}
    page = null
    if (child) {
      killBrowserTree(child)
      child = null
    }
    if (profile) {
      const dirToDelete = profile
      profile = ''
      setTimeout(() => {
        try {
          fs.rmSync(dirToDelete, { recursive: true, force: true })
        } catch {}
      }, 2500).unref?.()
    }
  }

  const ensureReady = async () => {
    if (page !== null) return
    const browser = findBrowser()
    if (browser === '') {
      const e = /** @type {Error & { code: string }} */ (new Error('没找到可用的 Chromium（Edge / Chrome）。请安装其一，或设置 ZCODE_WELFARE_BROWSER 指向可执行文件。'))
      e.code = 'BROWSER_NOT_FOUND'
      throw e
    }
    const port = 9200 + Math.floor(Math.random() * 500)
    profile = path.join(os.tmpdir(), `dx-zcode-captcha-sess-${randomUUID().slice(0, 8)}`)
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled',
      '--window-position=-10000,-10000',
      '--window-size=480,320',
      'about:blank',
    ]
    logger.info?.('[dx-zcode] 启动可复用浏览器会话求解验证码…')
    child = spawn(browser, args, { stdio: 'ignore', windowsHide: false, detached: false })
    const target = await waitForDebugger(port, 20000)
    page = await cdp(target)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.navigate', { url: 'https://zcode.z.ai/' })
    await sleep(2500)
  }

  return {
    async solveNext() {
      let lastError = null
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await ensureReady()
          const param = await page.evaluate(buildSdkScript(CAPTCHA_CONFIG))
          if (typeof param !== 'string' || param.length < 100) {
            const e = /** @type {Error & { code: string }} */ (new Error(`验证码求解失败：verifyParam 长度异常（${typeof param === 'string' ? param.length : 'n/a'}）。可能弹出了滑块，需要人工处理一次。`))
            e.code = 'CAPTCHA_REJECTED'
            throw e
          }
          cache = { param, region: CAPTCHA_CONFIG.region, at: Date.now() }
          logger.info?.(`[dx-zcode] 会话内验证码已获取（${param.length} 字节）`)
          return { param, region: CAPTCHA_CONFIG.region }
        } catch (error) {
          lastError = error
          if (/** @type {any} */ (error)?.code === 'BROWSER_NOT_FOUND') throw error
          logger.warn?.(`[dx-zcode] 复用会话第 ${attempt + 1}/2 次求解异常，尝试重建页面：${error instanceof Error ? error.message : String(error)}`)
          await teardown()
        }
      }
      throw lastError
    },
    async close() {
      await teardown()
    },
  }
}

/**
 * 启动浏览器，跑官方 SDK，取回 verifyParam。
 * @param {any} logger
 * @returns {Promise<{ param: string, region: string }>}
 */
async function runSolver(logger) {
  const browser = findBrowser()
  if (browser === '') {
    const e = /** @type {Error & { code: string }} */ (new Error('没找到可用的 Chromium（Edge / Chrome）。请安装其一，或设置 ZCODE_WELFARE_BROWSER 指向可执行文件。'))
    e.code = 'BROWSER_NOT_FOUND'
    throw e
  }
  // C11：调试端口类瞬时故障（端口撞车等）最多重试 3 次；滑块/脚本类失败重试无意义直接抛
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await solveOnce(browser, logger)
    } catch (error) {
      lastError = error
      if (/** @type {any} */ (error)?.code === 'CAPTCHA_REJECTED' || /** @type {any} */ (error)?.code === 'PAGE_SCRIPT') throw error
      logger.warn?.(`[dx-zcode] 验证码求解第 ${attempt + 1}/3 次失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw lastError
}

/** 跑一次完整求解流程（独立端口 + 独立临时 profile）。 */
async function solveOnce(browser, logger) {
  const port = 9200 + Math.floor(Math.random() * 500)
  const profile = path.join(os.tmpdir(), `dx-zcode-captcha-${randomUUID().slice(0, 8)}`)
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-blink-features=AutomationControlled',
    '--window-position=-10000,-10000',
    '--window-size=480,320',
    'about:blank',
  ]
  logger.info?.('[dx-zcode] 启动浏览器求解验证码…')
  const child = spawn(browser, args, { stdio: 'ignore', windowsHide: false, detached: false })

  try {
    const target = await waitForDebugger(port, 20000)
    const page = await cdp(target)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.navigate', { url: `https://zcode.z.ai/` })
    await sleep(2500)

    const param = await page.evaluate(buildSdkScript(CAPTCHA_CONFIG))
    await page.close()
    if (typeof param !== 'string' || param.length < 100) {
      const e = /** @type {Error & { code: string }} */ (new Error(`验证码求解失败：verifyParam 长度异常（${typeof param === 'string' ? param.length : 'n/a'}）。可能弹出了滑块，需要人工处理一次。`))
      e.code = 'CAPTCHA_REJECTED'
      throw e
    }
    logger.info?.(`[dx-zcode] 验证码已获取（${param.length} 字节）`)
    return { param, region: CAPTCHA_CONFIG.region }
  } finally {
    killBrowserTree(child)
    setTimeout(() => {
      try {
        fs.rmSync(profile, { recursive: true, force: true })
      } catch {
        /* 目录可能仍被占用。 */
      }
    }, 3000).unref?.()
  }
}

/** C11：Edge/Chrome 偶发 kill 不掉——Windows 用 taskkill /T /F 兜底整树清理。 */
function killBrowserTree(child) {
  try { child.kill() } catch {}
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch {
      /* taskkill 不可用时保留原 kill 结果。 */
    }
  }
}

/**
 * 等 CDP 端点就绪，返回一个 page target 的 webSocketDebuggerUrl。
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function waitForDebugger(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    /** @type {() => void} */
    const tick = () => {
      http.get({ host: '127.0.0.1', port, path: '/json/list', timeout: 1000 }, (res) => {
        /** @type {Buffer[]} */
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            const list = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const page = list.find((t) => t.type === 'page')
            if (page?.webSocketDebuggerUrl) {
              resolve(page.webSocketDebuggerUrl)
              return
            }
          } catch {
            /* 还没起来。 */
          }
          retry()
        })
      }).on('error', retry)
    }
    /** @type {() => void} */
    const retry = () => {
      if (Date.now() > deadline) {
        reject(Object.assign(new Error('浏览器调试端口没有就绪'), { code: 'BROWSER_TIMEOUT' }))
        return
      }
      setTimeout(tick, 300)
    }
    tick()
  })
}

/**
 * 极简 CDP 客户端（只用到 Runtime.evaluate）。
 * @param {string} wsUrl
 * @returns {Promise<{ send: (method: string, params?: any) => Promise<any>, evaluate: (expr: string) => Promise<any>, close: () => void }>}
 */
async function cdp(wsUrl) {
  const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }))
  const ws = new WebSocket(wsUrl)
  let nextId = 1
  /** @type {Map<number, { resolve: (v:any)=>void, reject: (e:any)=>void }>} */
  const pending = new Map()
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(undefined), { once: true })
    ws.addEventListener('error', () => reject(Object.assign(new Error('CDP 连接失败'), { code: 'CDP_CONNECT' })), { once: true })
  })
  ws.addEventListener('message', (event) => {
    let msg
    try {
      msg = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (msg.id === undefined) return
    const entry = pending.get(msg.id)
    if (entry === undefined) return
    pending.delete(msg.id)
    if (msg.error !== undefined) entry.reject(new Error(msg.error.message ?? 'CDP error'))
    else entry.resolve(msg.result)
  })
  /** @param {string} method @param {any} [params] */
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return {
    send,
    async evaluate(expr) {
      const result = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
      if (result?.exceptionDetails) {
        throw Object.assign(new Error(`页面脚本异常：${result.exceptionDetails.text ?? ''}`), { code: 'PAGE_SCRIPT' })
      }
      return result?.result?.value
    },
    close() {
      try {
        ws.close()
      } catch {
        /* 已关闭。 */
      }
    },
  }
}

/**
 * 在页面上跑阿里云无感 SDK，返回 verifyParam。
 *
 * 官方 SDK 走 `window.initAliyunCaptcha` 风格初始化；这里做两种兼容：
 * 有官方全局就用官方的，没有就用 SDK 脚本直接拉起来。
 * @param {{ region: string, prefix: string, sceneId: string }} cfg
 * @returns {string}
 */
function buildSdkScript(cfg) {
  return `(async () => {
    const prev = document.getElementById('zcode-aliyun-captcha-container');
    if (prev) prev.remove();
    const d = document.createElement('div');
    d.id = 'zcode-aliyun-captcha-container';
    d.innerHTML = '<div id="zcode-aliyun-captcha-element"></div><button id="zcode-aliyun-captcha-button">ok</button>';
    document.body.appendChild(d);
    const loadScript = (src) => new Promise((resolve, reject) => {
      if (document.querySelector('script[src="' + src + '"]')) return resolve(true);
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => resolve(true);
      el.onerror = () => reject(new Error('load ' + src));
      document.head.appendChild(el);
    });
    try {
      await loadScript('https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js');
    } catch (e) {
      return 'SCRIPT_LOAD_FAILED:' + (e && e.message ? e.message : '');
    }
    const init = window.initAliyunCaptcha || window.AliyunCaptcha?.initAliyunCaptcha;
    if (typeof init !== 'function') {
      return 'SDK_MISSING:' + Object.keys(window).filter(k => /captcha/i.test(k)).join(',');
    }
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('TIMEOUT'), 20000);
      const done = (v) => { clearTimeout(timer); resolve(v); };
      try {
        window.AliyunCaptchaConfig = { region: ${JSON.stringify(cfg.region)}, prefix: ${JSON.stringify(cfg.prefix)} };
        init({
          SceneId: ${JSON.stringify(cfg.sceneId)},
          mode: 'popup',
          element: '#zcode-aliyun-captcha-element',
          button: document.getElementById('zcode-aliyun-captcha-button'),
          getInstance: (inst) => {
            try {
              if (inst && typeof inst.startTracelessVerification === 'function') {
                inst.startTracelessVerification();
              } else if (inst && typeof inst.show === 'function') {
                inst.show();
              }
            } catch (e) {
              done('GET_INSTANCE_FAILED:' + (e && e.message ? e.message : ''));
            }
          },
          success: (param) => {
            const p = typeof param === 'string' ? param : (param && param.captchaVerifyParam);
            done(p);
          },
          fail: (e) => {
            done('FAIL:' + JSON.stringify(e));
          },
          onError: (e) => {
            done('ERROR:' + JSON.stringify(e));
          }
        });
      } catch (e) {
        done('INIT_FAILED:' + (e && e.message ? e.message : ''));
      }
    });
  })()`
}

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
