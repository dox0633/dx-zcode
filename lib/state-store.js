/**
 * account-state.json 的统一读写层（C4）。
 *
 * 内存缓存 + 变更时落盘：读路径零 IO（pick/isModelDisabled 等高频调用不再
 * 反复读文件），写路径保持 tmp+rename 原子替换。pool 与 login 共用本模块，
 * 避免 login 直写文件绕过缓存导致的状态回退。
 *
 * 注意：全同步实现，单线程事件循环内天然原子，无需互斥。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** 插件数据根（受管密钥/状态文件/pkgs/shadow 同根）。 */
export const DATA_ROOT = process.env.DSH_WELFARE_BASE
  ?? path.join(os.homedir(), '.dsh', 'dx-zcode')

const STATE_FILE = path.join(DATA_ROOT, 'account-state.json')

/** @type {Record<string, any> | null} */
let cache = null

/** @returns {Record<string, any>} */
export function readPersistedState() {
  if (cache !== null) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    cache = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    cache = {}
  }
  return cache
}

/**
 * @param {Record<string, any>} state
 * @returns {void}
 */
export function writePersistedState(state) {
  cache = state
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    const tmp = STATE_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n')
    fs.renameSync(tmp, STATE_FILE)
  } catch {
    /* 状态持久化失败只影响重启后的记忆，不影响运行。 */
  }
}

/** 供诊断/测试：丢弃内存缓存，强制下次读盘。@returns {void} */
export function resetStateCache() {
  cache = null
}
