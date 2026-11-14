import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 插件根目录（src 的上一级）
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 运行时状态：{ sessionId }，桌宠说的话发到哪个会话；重启后继续用同一个
const STATE_PATH = path.join(ROOT, 'data', 'state.json')

export function loadState() {
  try {
    // 去掉 BOM，否则 JSON.parse 会报错
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8').replace(/^﻿/, ''))
  } catch {
    return {}
  }
}

export function saveState(patch) {
  const next = { ...loadState(), ...patch }
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  // 先写临时文件再改名，避免写到一半断电把文件写坏
  const tmp = STATE_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, STATE_PATH)
}

// 简单日志：写进 data/dafei.log，超过 1MB 就从头写
const LOG_PATH = path.join(ROOT, 'data', 'dafei.log')

export function log(...args) {
  const line = `[${new Date().toLocaleString()}] ${args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 1024 * 1024) fs.writeFileSync(LOG_PATH, '')
    fs.appendFileSync(LOG_PATH, line)
  } catch {}
}
