#!/usr/bin/env node
/**
 * 全功能实测审计（在 DSH 之外运行，需要完整环境 + 真实账号凭据）。
 *
 * 覆盖六项需求，全部真实执行：
 *   [1] CLI 定位（builtin 内核）
 *   [2] 账号池加载（凭据解密 + 站点识别）
 *   [3] 模型通道 / 3012 —— 真实回合：spawn 官方 CLI app-server →
 *       session/create → setModel → send 一条最小消息 → 观察
 *       turn.completed（无 3012）或 turn.failed（打印归因）
 *   [4] 福利探测 —— 真实 HTTP：marketing/touch + billing/balance
 *       （领取需要人机验证，不在无头审计里执行）
 *   [5] 网关 —— 真实启动 + /health + /v1/models + 真实 chat 请求
 *   [6] 调用记录 —— 网关请求后 callLog 必须有带账号/token 的条目
 *   [7] 登录 env 模式 —— CLI 凭据初始化是否可用（不完成浏览器授权）
 *   [8] 启停持久化 —— disable → state 文件 → 重载保持
 *
 * 用法：node bin/audit-live.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const lib = (name) => pathToFileURL(path.join(root, 'lib', name))

const { locateCli, resolveDataBaseDir, ensureManagedSecret } = await import(lib('credentials.js'))
const { AccountPool, environmentFacts } = await import(lib('pool.js'))
const { AppServerClient, createSession, setModel, subscribe, send } = await import(lib('app-server.js'))
const { survey } = await import(lib('welfare.js'))
const { Gateway } = await import(lib('gateway.js'))
const { CallLog } = await import(lib('calllog.js'))
const { loginWithCli } = await import(lib('login.js'))
const dxz = await import(lib('index.js'))

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
const section = (t) => console.log(`\n──── ${t} ────`)

// 受管密钥（与插件 apply() 同款初始化）
process.env.ZCODE_CREDENTIAL_SECRET_FILE = ensureManagedSecret()

// ── [1] CLI ──────────────────────────────────────────────────────────────
section('[1] CLI 定位')
let cli = null
try {
  cli = locateCli('')
  record('CLI 定位', cli.hasBuiltin, `${cli.path} v${cli.version} builtin=${cli.hasBuiltin}`)
} catch (e) {
  record('CLI 定位', false, e.message)
  finish()
}

// ── [2] 账号池 ───────────────────────────────────────────────────────────
section('[2] 账号池加载')
const logger = { info: () => {}, warn: (m) => console.log('  [warn]', m) }
const pool = new AccountPool({ options: () => ({ zcodeCliPath: '', zcodeDataBaseDir: '', extraDataDirs: [], zswitchDataRoot: '' }), logger })
await pool.load()
const entries = pool.list().filter((e) => e.account !== null)
const account = entries[0]?.account ?? null
record('账号池加载', account !== null, entries.length
  ? entries.map((e) => `${e.label}(${e.account.provider}${e.shadowed ? '/影子' : ''})`).join(', ')
  : (pool.list()[0]?.error ?? '空池'))
if (account === null) finish()

// ── [3] 模型通道 / 3012 真实回合 ─────────────────────────────────────────
section('[3] 模型通道 / 3012 真实回合')
let client = null
let catalogModels = []
let route = null
try {
  client = new AppServerClient({
    cliPath: account.cliPath || cli.path,
    dataBaseDir: account.dataBaseDir,
    logger,
  })
  await client.ensureStarted()
  const session = await createSession(client, { workspacePath: root })
  catalogModels = session.models
  const accountModels = session.models.filter((m) => /^account:/.test(String(m?.ref?.providerId ?? '')))
  console.log(`  模型目录：${session.models.length} 项，其中账号通道 ${accountModels.length} 项`)
  for (const m of accountModels.slice(0, 6)) {
    console.log(`    - ${m.ref.providerId} / ${m.ref.modelId}  ${m.label ?? ''}`)
  }
  if (accountModels.length === 0) {
    record('3012/模型通道', false, '目录里没有 account: 通道（builtin 解析失败？）')
  } else {
    // 优先 start-plan 通道的 GLM-5.3-Flash（福利额度桶，实际有钱可烧）；
    // 退回第一个 start-plan 模型。setModel 必须带目录声明的 reasoning 档位
    const chosen =
      accountModels.find((m) => String(m.ref.providerId).includes('start-plan') && String(m.ref.modelId).toLowerCase().includes('flash')) ??
      accountModels.find((m) => String(m.ref.providerId).includes('start-plan')) ??
      accountModels[0]
    route = {
      providerId: chosen.ref.providerId,
      modelId: chosen.ref.modelId,
      reasoningLevel: String(chosen.reasoning?.defaultLevel ?? '') || undefined,
    }
    await subscribe(client, session.sessionId)
    const current = session.raw?.current ?? session.raw?.selected ?? null
    if (current === null || current.providerId !== route.providerId || current.modelId !== route.modelId) {
      await setModel(client, session.sessionId, route)
    }
    const verdict = await new Promise((resolve) => {
      let settled = false
      const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ kind: 'timeout' }) } }, 120000)
      const off = client.onNotification((msg) => {
        if (msg.method !== 'session/event') return
        const p = msg.params ?? {}
        if (String(p.sessionId ?? '') !== session.sessionId) return
        const type = String(p.type ?? '')
        if (type === 'session.updated') {
          const payload = p.payload ?? {}
          console.log(`  [通道] provider=${payload.providerId ?? '?'} baseURL=${payload.baseURL ?? '?'}`)
          return
        }
        if (type === 'turn.completed') {
          if (!settled) { settled = true; clearTimeout(timer); off(); resolve({ kind: 'completed', usage: p.payload?.usage ?? null }) }
          return
        }
        if (type === 'turn.failed') {
          if (!settled) {
            settled = true; clearTimeout(timer); off()
            resolve({ kind: 'failed', error: String(p.payload?.error?.message ?? p.payload?.message ?? 'turn.failed') })
          }
        }
      })
      send(client, session.sessionId, '这是一条通道测试消息：只回复两个字——成功').catch((e) => {
        if (!settled) { settled = true; clearTimeout(timer); off(); resolve({ kind: 'send-error', error: String(e?.message ?? e) }) }
      })
    })
    if (verdict.kind === 'completed') {
      record('3012/模型通道（真实回合）', true, `turn.completed usage=${JSON.stringify(verdict.usage ?? {})}`)
    } else {
      const is3012 = /3012|not supported/i.test(verdict.error ?? '')
      record('3012/模型通道（真实回合）', false, `${verdict.kind}${is3012 ? ' [3012 确认]' : ''}: ${(verdict.error ?? '').slice(0, 200)}`)
    }
  }
} catch (e) {
  record('3012/模型通道（真实回合）', false, `${e.code ?? ''} ${e.message.slice(0, 160)}`)
}

// ── [4] llm 目录契约（对话框模型列表的数据源） ────────────────────────────
section('[4] llm 目录契约（对话框「加载失败」的根源）')
try {
  const adapter = new dxz.ZcodeWelfareAdapter({ pool, options: () => dxz.resolveOptions({}), logger, callLog: new CallLog() })
  // 模型目录只对主渠道投放（别名渠道返回空数组是设计行为）——契约测试用主渠道 id
  const listed = await adapter.listModels('dx-zcode')
  const bad = listed.filter((m) => m.provider !== 'dx-zcode' || typeof m.id !== 'string' || m.id === '' || typeof m.name !== 'string' || m.name === '')
  record('llm 目录契约', listed.length > 0 && bad.length === 0,
    `${listed.length} 个模型（provider 字段${bad.length === 0 ? '全部合规' : '缺失/错误 ' + bad.length + ' 条'}）: ${listed.slice(0, 4).map((m) => m.id).join(', ')}`)
} catch (e) {
  record('llm 目录契约', false, e.message.slice(0, 160))
}

// ── [5] 福利探测 ─────────────────────────────────────────────────────────
section('[5] 福利探测（真实 HTTP）')
try {
  const snap = await survey(account, account.cliVersion || cli.version)
  const claimable = snap.plans.filter((p) => p.claimable)
  record('福利探测', snap.notes.length === 0,
    `套餐 ${snap.plans.length} 个（可领 ${claimable.length}）· 已生效 ${snap.availableUnits} · 待生效 ${snap.pendingUnits}` +
    (claimable.length ? ` · 可领：${claimable.map((p) => p.name).join('、')}` : '') +
    (snap.notes.length ? ` · 备注：${snap.notes.join(' | ').slice(0, 160)}` : ''))
} catch (e) {
  record('福利探测', false, `${e.code ?? ''} ${e.message.slice(0, 160)}`)
}

// ── [5][6] 网关 + 调用记录 ───────────────────────────────────────────────
section('[5] 网关（真实启动 + 真实请求）  [6] 调用记录')
const callLog = new CallLog()
if (route === null || client === null) {
  record('网关启动+请求', false, '跳过：模型通道不可用')
  record('调用记录', false, '跳过')
} else {
  const gateway = new Gateway({
    port: 8799, host: '127.0.0.1', authToken: '', logger,
    callLog,
    resolveRoute: () => {
      const entry = pool.pick() ?? pool.list().find((e) => e.account !== null)
      if (entry === null || entry.account === null) return null
      return { client, account: entry.account, model: route }
    },
  })
  try {
    await gateway.start()
    const get = (p) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: 8799, path: p }, (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => resolve({ status: res.statusCode, body: b }))
      }).on('error', reject)
    })
    const post = (p, body) => new Promise((resolve, reject) => {
      const data = JSON.stringify(body)
      const req = http.request({ host: '127.0.0.1', port: 8799, path: p, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => resolve({ status: res.statusCode, body: b }))
      })
      req.on('error', reject)
      req.end(data)
    })
    const health = await get('/health')
    record('网关 /health', health.status === 200 && JSON.parse(health.body).ok === true, health.body.slice(0, 120))
    const models = await get('/v1/models')
    record('网关 /v1/models', models.status === 200, models.body.slice(0, 120))
    const chat = await post('/v1/chat/completions', {
      model: route.modelId,
      messages: [{ role: 'user', content: '通道测试：只回复两个字——成功' }],
    })
    let chatOk = false, chatDetail = chat.body.slice(0, 160)
    try {
      const j = JSON.parse(chat.body)
      const text = j.choices?.[0]?.message?.content ?? ''
      chatOk = chat.status === 200 && text !== ''
      chatDetail = `status=${chat.status} content="${String(text).slice(0, 40)}"`
    } catch { /* 非 JSON */ }
    record('网关 chat 请求（真实）', chatOk, chatDetail)
    await gateway.stop()
  } catch (e) {
    record('网关启动+请求', false, e.message.slice(0, 160))
    await gateway.stop().catch(() => {})
  }
  const logs = callLog.view(5)
  const entry = logs[0]
  record('调用记录', entry !== undefined && entry.account !== undefined && entry.ok === true,
    entry ? `${entry.account} / ${entry.model} / ${entry.durationMs}ms / tokens=${JSON.stringify(entry.tokens ?? null)}` : '无条目')
}

// ── [7] 登录 env 模式（凭据初始化检查，不完成浏览器授权） ────────────────
section('[7] 登录凭据初始化（env 模式，不完成授权）')
try {
  await loginWithCli({
    cliPath: cli.path,
    dataBaseDir: resolveDataBaseDir(''),
    provider: 'zai',
    logger,
    timeoutMs: 12000,
  })
  record('登录凭据初始化', true, '12 秒内登录进程存活等待授权（凭据存储初始化通过）')
} catch (e) {
  const msg = String(e.message ?? e)
  const credFail = /System credential storage|credential store/i.test(msg)
  if (e.code === 'LOGIN_TIMEOUT') {
    record('登录凭据初始化', true, '超时前一直等待授权 = 凭据初始化通过')
  } else {
    record('登录凭据初始化', false, (credFail ? '[OS 凭据库仍不可用] ' : '') + msg.slice(0, 180))
  }
}

// ── [8] 启停持久化 ───────────────────────────────────────────────────────
section('[8] 账号启停持久化')
try {
  const target = pool.list().find((e) => e.account !== null)
  if (target === undefined) {
    record('启停持久化', false, '无账号可测')
  } else {
    pool.update(target.id, { enabled: false })
    const stateFile = path.join(
      process.env.DSH_WELFARE_BASE ?? path.join(process.env.USERPROFILE ?? process.env.HOME, '.dsh', 'dx-zcode'),
      'account-state.json',
    )
    const stateRaw = fs.readFileSync(stateFile, 'utf8')
    const persisted = JSON.parse(stateRaw)[target.id]?.enabled === false
    pool.update(target.id, { enabled: true })
    record('启停持久化', persisted, `${target.label} disable→落盘→restore`)
  }
} catch (e) {
  record('启停持久化', false, e.message.slice(0, 140))
}

// ── 汇总 ────────────────────────────────────────────────────────────────
function finish() {
  console.log('\n════════ 实测汇总 ════════')
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`)
  const fails = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - fails}/${results.length} 通过${fails ? ' —— 存在失败项，见上' : ' —— 全部通过'}`)
  try { client?.dispose() } catch {}
  process.exit(fails === 0 ? 0 : 1)
}
finish()
