/** V6：验证 direct-channel.js 全链路——SSE 文本轮 + 工具调用往返 */
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const lib = (n) => pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', n))
const { readAccount, locateCli } = await import(lib('credentials.js'))
const dc = await import(lib('direct-channel.js'))

const cli = locateCli('')
const account = readAccount({ dataBaseDir: '', cliPath: cli.path })
const base = { planToken: account.planToken, deviceMid: account.deviceMid }

// ── ① 纯文本流式 ──
console.log('== ① 文本轮（SSE）==')
const chunks1 = []
for await (const c of dc.streamDirectCall({
  ...base, modelId: 'GLM-5.3-Flash', maxTokens: 64,
  system: '你是测试助手，回答保持极短。',
  messages: [{ role: 'user', content: [{ type: 'text', text: '只回复两个字：成功' }] }],
})) {
  chunks1.push(c)
  if (c.type === 'text-delta') process.stdout.write(c.text)
}
console.log()
console.log('chunks:', chunks1.map((c) => c.type).join(','))
const usage1 = chunks1.find((c) => c.type === 'usage')
const finish1 = chunks1.find((c) => c.type === 'finish')
console.log('usage:', JSON.stringify(usage1?.usage), '| finish:', JSON.stringify(finish1?.reason))

// ── ② 工具调用往返 ──
console.log('\n== ② 工具调用往返 ==')
const tools = [{
  name: 'get_weather',
  description: '查询指定城市的当前天气',
  parameters: { type: 'object', properties: { city: { type: 'string', description: '城市名' } }, required: ['city'] },
}]
const chunks2 = []
for await (const c of dc.streamDirectCall({
  ...base, modelId: 'GLM-5.3-Flash', maxTokens: 512, tools,
  messages: [{ role: 'user', content: [{ type: 'text', text: '查一下北京天气' }] }],
})) {
  chunks2.push(c)
  if (c.type === 'tool-call-delta') process.stdout.write(`[tool:${c.name} ${c.argumentsDelta}]`)
  else if (c.type === 'text-delta') process.stdout.write(c.text)
}
console.log()
const finish2 = chunks2.find((c) => c.type === 'finish')
console.log('chunks:', chunks2.map((c) => c.type).join(','), '| finish:', JSON.stringify(finish2?.reason))

// 从增量重建 tool_use（模拟 DSH assembler）
const toolCalls = new Map()
for (const c of chunks2) {
  if (c.type === 'tool-call-delta') {
    const cur = toolCalls.get(c.index) ?? { id: c.id, name: c.name, args: '' }
    cur.args += c.argumentsDelta
    toolCalls.set(c.index, cur)
  }
}
const calls = [...toolCalls.values()]
console.log('重建 tool_use:', JSON.stringify(calls.map((c) => ({ id: c.id.slice(0, 12), name: c.name, args: c.args }))))

// ── ③ 工具结果回传（历史含 tool_use、无 thinking 块）──
console.log('\n== ③ 工具结果回传 ==')
const messages3 = [
  { role: 'user', content: [{ type: 'text', text: '查一下北京天气' }] },
  { role: 'assistant', content: calls.map((c) => ({ type: 'tool-call', id: c.id, name: c.name, arguments: c.args })) },
  { role: 'tool', toolCallId: calls[0]?.id, content: [{ type: 'text', text: '北京 晴 12°C' }] },
]
const chunks3 = []
for await (const c of dc.streamDirectCall({
  ...base, modelId: 'GLM-5.3-Flash', maxTokens: 64, tools,
  messages: messages3,
})) {
  chunks3.push(c)
  if (c.type === 'text-delta') process.stdout.write(c.text)
}
console.log()
const finish3 = chunks3.find((c) => c.type === 'finish')
console.log('chunks:', chunks3.map((c) => c.type).join(','), '| finish:', JSON.stringify(finish3?.reason))
console.log('\n== V6 完成 ==')
