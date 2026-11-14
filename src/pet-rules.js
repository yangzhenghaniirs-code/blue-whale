// 桌宠说的话交给会话前，加上开头标签（默认 [from the blue whale]，不带时间）
//   prompt 模式（默认）：标签 + 话 + 插件根目录「桌宠规则.md」的全文，每句都带
//   tag 模式：只带标签 + 话；规则由用户自己贴进角色的记忆 / AGENTS.md
// 规则文件每次读，改完不用重启 DSH
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './state.js'

export const RULES_FILE = path.join(ROOT, '桌宠规则.md')

export function loadRules() {
  try {
    return fs.readFileSync(RULES_FILE, 'utf8').replace(/^﻿/, '').trim()
  } catch {
    return ''
  }
}

export function petMessage(speech, cfg) {
  const head = `${cfg.petTag} ${speech}`.trim()
  if (cfg.ruleMode !== 'prompt') return head
  const rules = loadRules()
  return rules ? `${head}\n\n（${rules}）` : head
}
