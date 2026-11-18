// 桌宠说的话交给会话前，加上开头标签（默认 [from the blue whale]，不带时间）
//   tag 模式（默认）：只带标签 + 话；规则由用户自己贴进角色的记忆 / 人设
//     启动时把可直接粘贴的规则写到 ~/.dsh/blue-whale/贴进记忆的桌宠规则.txt，第一次还弹通知提醒
//   prompt 模式：标签 + 话 + 插件根目录「桌宠规则.md」的全文，每句都带
// 规则文件每次读，改完不用重启 DSH
// 0.4.0 起：~/.dsh/blue-whale/桌宠规则.md 存在就用它（插件更新不会冲掉）；没有才用插件自带的
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ROOT, loadState, saveState, log } from './state.js'

export const RULES_FILE = path.join(ROOT, '桌宠规则.md')
export const USER_RULES_FILE = path.join(os.homedir(), '.dsh', 'blue-whale', '桌宠规则.md')

export function loadRules() {
  try {
    return fs.readFileSync(fs.existsSync(USER_RULES_FILE) ? USER_RULES_FILE : RULES_FILE, 'utf8').replace(/^﻿/, '').trim()
  } catch {
    return ''
  }
}

export function petMessage(speech, cfg) {
  const head = `${cfg.petTag} ${speech}`.trim()
  // 插件页里「每句附上桌宠规则」组件打开时，tag 模式也附上规则（src/prompt-rules.js）
  const attach = cfg.ruleMode === 'prompt' || globalThis[Symbol.for('bluewhale.promptRules')] === true
  if (!attach) return head
  const rules = loadRules()
  return rules ? `${head}\n\n（${rules}）` : head
}

// 贴进角色记忆用的一段话：说明标签的意思 + 规则全文
export const MEMORY_RULE_FILE = path.join(os.homedir(), '.dsh', 'blue-whale', '贴进记忆的桌宠规则.txt')

export function memoryRuleText(cfg) {
  return `桌宠当面语音回复约定：带 ${cfg.petTag} 标签的消息，是对方在桌宠面前当面对你说的话，按下面的规则回复。\n${loadRules()}`
}

// tag 模式：每次启动都把最新规则写一份到 .dsh\blue-whale；第一次额外弹通知，告诉用户要把它告诉角色
export function tagModeHint(cfg, notify) {
  if (cfg.ruleMode !== 'tag') return
  try {
    fs.mkdirSync(path.dirname(MEMORY_RULE_FILE), { recursive: true })
    fs.writeFileSync(MEMORY_RULE_FILE, '\ufeff' + memoryRuleText(cfg).replace(/\r?\n/g, '\r\n') + '\r\n')
  } catch (e) {
    return log('写贴进记忆的桌宠规则失败：', e.message)
  }
  if (loadState().tagHintShown) return
  notify(`blue whale 用的是标签模式：请把「${MEMORY_RULE_FILE}」里的内容发给角色，让它记住（只需一次），桌宠的表情动作才会对。不想弄的话，在 DSH「插件 → blue whale」里打开「每句附上桌宠规则」。`)
  saveState({ tagHintShown: true })
}
