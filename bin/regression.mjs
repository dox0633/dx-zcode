#!/usr/bin/env node
/**
 * 纯函数层回归测试（壳外可跑，不依赖 DSH 宿主）。
 * 覆盖：state-store 缓存一致性、isPluginOwnedDir 删除守卫、bindSession 真 LRU、
 * 通道黑名单标记/过期、gateway prompt 转换、welfare 归一化、calllog tokensOf、
 * 验证码 per-plan 求解流（mock getVerification）。
 *
 * 运行：node bin/regression.mjs
 */
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const results = []
const test = (name, fn) => {
  try {
    fn()
    results.push(`PASS ${name}`)
  } catch (error) {
    results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

// 沙盒数据根：把 DSH_WELFARE_BASE 指到临时目录，避免污染真实 ~/.dsh/dx-zcode
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dxz-regression-'))
process.env.DSH_WELFARE_BASE = sandbox

// ── state-store ───────────────────────────────────────────────────────────────
const { DATA_ROOT, readPersistedState, writePersistedState } = await import('../lib/state-store.js')
test('state-store: DATA_ROOT 指向沙盒', () => {
  assert.strictEqual(DATA_ROOT, sandbox)
})
test('state-store: 写后读一致（内存缓存）', () => {
  writePersistedState({ a: { enabled: false } })
  assert.strictEqual(readPersistedState().a.enabled, false)
  // 落盘验证
  const raw = JSON.parse(fs.readFileSync(path.join(sandbox, 'account-state.json'), 'utf8'))
  assert.strictEqual(raw.a.enabled, false)
})

// ── pool.js：删除守卫 / LRU / 通道黑名单 ──────────────────────────────────────
const { isPluginOwnedDir, AccountPool } = await import('../lib/pool.js')
test('A1: 插件自建目录判定为 owned', () => {
  assert.strictEqual(isPluginOwnedDir(path.join(DATA_ROOT, 'accounts', 'zc-123')), true)
  assert.strictEqual(isPluginOwnedDir(path.join(DATA_ROOT, 'shadow', 'abc')), true)
  assert.strictEqual(isPluginOwnedDir(DATA_ROOT), false)
})
test('A1: 外部目录判定为非 owned（删除守卫核心）', () => {
  assert.strictEqual(isPluginOwnedDir('D:\\zcode-backup'), false)
  assert.strictEqual(isPluginOwnedDir('D:\\my accounts\\data'), false, '路径含 accounts 子串但不在 DATA_ROOT 下，必须非 owned')
  assert.strictEqual(isPluginOwnedDir(os.homedir()), false)
  assert.strictEqual(isPluginOwnedDir(''), false)
})
function makePool() {
  return new AccountPool({ options: () => ({}), logger: { info() {}, warn() {} } })
}
test('B5: bindSession 超限按 LRU 只删最旧', () => {
  const pool = makePool()
  for (let i = 0; i < 1100; i++) {
    pool.bindSession(`s${i}`, 'acc')
    pool.sessionBindings.get(`s${i}`).lastUsedAt = i // 人为设定时间序
  }
  assert.strictEqual(pool.sessionBindings.size <= 1000, true)
  // 最旧的 s0.. 被删，最新的 s1099 仍在
  assert.strictEqual(pool.sessionBindings.has('s1099'), true)
  assert.strictEqual(pool.sessionBindings.has('s0'), false)
})
test('B13: 通道黑名单标记与过期', () => {
  const pool = makePool()
  pool.markChannelUnavailable('acc1', 'account:zai-individual-coding-plan', 50)
  assert.strictEqual(pool.isChannelBlacklisted('acc1', 'account:zai-individual-coding-plan'), true)
  assert.strictEqual(pool.isChannelBlacklisted('acc1', 'account:zai-start-plan'), false)
  // 过期：手动把时间戳拨回过去
  pool.channelBlacklist.get('acc1').set('account:zai-individual-coding-plan', Date.now() - 1)
  assert.strictEqual(pool.isChannelBlacklisted('acc1', 'account:zai-individual-coding-plan'), false)
})
test('B13: 黑名单持久化落盘', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(sandbox, 'account-state.json'), 'utf8'))
  assert.ok(raw.__channelBlacklist && raw.__channelBlacklist.acc1, '黑名单应写入 account-state.json')
})
function await0() {}


// ── gateway.js：prompt 转换 ───────────────────────────────────────────────────
const { openAIToPrompt, anthropicToPrompt } = await import('../lib/gateway.js')
test('gateway: openAI 多角色扁平化', () => {
  const p = openAIToPrompt({ messages: [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'U1' },
    { role: 'assistant', content: 'A1' },
    { role: 'user', content: 'U2' },
  ] })
  assert.strictEqual(p, 'S\n\nU1\n\n[assistant]\nA1\n\nU2')
})
test('gateway: anthropic system + content blocks（image 落占位符）', () => {
  const p = anthropicToPrompt({ system: 'S', messages: [{ role: 'user', content: [{ type: 'text', text: 'U' }, { type: 'image', source: {} }] }] })
  assert.strictEqual(p, 'S\n\nU\n[图片]')
})

// ── welfare.js：归一化 + per-plan 验证码流 ────────────────────────────────────
const { normalizeDelivery, claimAll: welfareClaimAll } = await import('../lib/welfare.js')
test('welfare: normalizeDelivery 提取 plan 卡片', () => {
  const cards = normalizeDelivery({ zcode_plan: { plan_id: 'p1', name: 'N', ends_at: 0, starts_at: 0, entitlements: [{ grant_units: 100, capabilities: ['x'] }] } })
  assert.strictEqual(cards.length, 1)
  assert.strictEqual(cards[0].grantUnits, 100)
})
test('A4: per-plan getVerification 每活动现取一枚验证码 + 3007 重试', async () => {
  let solved = 0
  const plans = [
    { planId: 'p1', name: 'P1', claimable: true },
    { planId: 'p2', name: 'P2', claimable: true },
  ]
  // mock survey：直接传 precomputed
  const calls = []
  const fakeVerification = {
    getVerification: async () => {
      solved++
      return { captchaVerifyParam: `param-${solved}`, captchaRegion: 'cn' }
    },
  }
  // 替换 fetch：mock claim 端点 —— p1 第一次 3007（param 被消耗），随后成功
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ plan: body.plan_id, param: init.headers['X-Aliyun-Captcha-Verify-Param'] })
    const n = calls.filter((c) => c.plan === body.plan_id).length
    if (body.plan_id === 'p1' && n === 1) {
      return new Response(JSON.stringify({ code: 3007 }), { status: 400 })
    }
    return new Response(JSON.stringify({ code: 0, message: 'ok' }), { status: 200 })
  }
  try {
    const r = await welfareClaimAll({ planToken: 'a.b.c', deviceMid: 'd' }, '3.19.0', fakeVerification, { plans, balances: [], serverTime: 1 })
    assert.deepStrictEqual(r.claimed, ['P1（ok）', 'P2（ok）'])
    // p1 被调用 2 次（3007 重试一次），每次 param 都不同
    const p1calls = calls.filter((c) => c.plan === 'p1')
    assert.strictEqual(p1calls.length, 2)
    assert.notStrictEqual(p1calls[0].param, p1calls[1].param, '重试必须使用新验证码')
    // p2 用的是第三枚（不复用 p1 的）
    const p2param = calls.find((c) => c.plan === 'p2').param
    assert.strictEqual(solved, 3)
    assert.strictEqual(p2param, 'param-3')
  } finally {
    globalThis.fetch = realFetch
  }
})

// ── calllog.js：tokensOf ──────────────────────────────────────────────────────
const { tokensOf } = await import('../lib/calllog.js')
test('calllog: uncached input 扣减缓存命中', () => {
  const t = tokensOf({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 800, totalTokens: 1900 })
  assert.strictEqual(t.input, 1000, '显式 inputTokens 视为 uncached，不再扣减')
  assert.strictEqual(t.cached, 800)
  assert.strictEqual(t.cacheRate, 44)
})
test('calllog: input_tokens 含缓存时扣减', () => {
  const t = tokensOf({ input_tokens: 1800, output_tokens: 100, cache_read_tokens: 800 })
  assert.strictEqual(t.input, 1000)
})

console.log(results.join('\n'))
console.log(process.exitCode ? '\n== 存在失败 ==' : '\n== 全部通过 ==')
