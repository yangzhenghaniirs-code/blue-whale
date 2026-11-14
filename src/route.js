// 分拣 AIRI 发来的请求：AIRI 说一句话会发好几个请求，只有真正的聊天请求才交给 DSH
//   聊天请求：最后一条 user 消息像 "[2026-10-25 13:49] 我说今天挺想你的。\n[Context]\n- system:..."
//   辅助请求：user 内容是 JSON，如 {"previousMessages":[],"transcript":"..."} 或 ["..."]（判断说完没有、修正识别结果）

const TIMESTAMP = /^\s*\[\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?\]\s*/
const CONTEXT = /(^|\n)\s*\[Context\]/

// 取最后一条 user 消息的文字；历史和 system 提示词都忽略
export function lastUserText(body) {
  const msg = (body?.messages || []).filter((m) => m.role === 'user').at(-1)
  if (!msg) return ''
  if (typeof msg.content === 'string') return msg.content.trim()
  if (Array.isArray(msg.content)) {
    return msg.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n').trim()
  }
  return ''
}

function looksLikeJson(text) {
  if (!/^[[{]/.test(text)) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

// 是不是真正的聊天请求：开头有 [时间戳]，或者带 [Context] 段；内容是 JSON 的一律算辅助请求
export function isChatRequest(body) {
  const text = lastUserText(body)
  if (!text || looksLikeJson(text)) return false
  return TIMESTAMP.test(text) || CONTEXT.test(text)
}

// 只留下真正说的话：删掉 [Context] 及之后的全部内容，再去掉开头的 [时间戳]
// 角色靠插件加的开头标签（pet-rules.js）认出这是桌宠消息，不再靠时间戳
export function extractSpeech(text) {
  return String(text ?? '')
    .split(CONTEXT)[0]
    .replace(TIMESTAMP, '')
    .trim()
}
