// AIRI 的辅助请求（不是聊天，是麦克风用的）：
//   判断说完没有（voice-end-judge）：回 {"complete": true}，等于只靠停顿判断说完
//   修正识别结果（voice-transcription-rephrase）：原样返回识别出的文字
// helperMode 为 "deepseek" 时改为转发给 DeepSeek API（要填 deepseekApiKey）

function systemText(body) {
  return (body?.messages || [])
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join('')))
    .join('\n')
}

export function localHelperReply(body, userText) {
  const sys = systemText(body)
  if (/finished a spoken message/i.test(sys)) return '{"complete": true}'
  if (/clean up text that speech recognition produced/i.test(sys)) {
    try {
      const segments = JSON.parse(userText)
      if (Array.isArray(segments)) return JSON.stringify(segments.map(String))
    } catch {}
  }
  // 认不出来的辅助请求：原样退回用户内容
  return userText
}

export async function forwardToDeepSeek(body, cfg) {
  const res = await fetch(`${cfg.deepseekUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.deepseekApiKey}` },
    body: JSON.stringify({ ...body, model: cfg.deepseekModel, stream: false }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`DeepSeek API 返回 HTTP ${res.status}`)
  const json = await res.json()
  return json.choices?.[0]?.message?.content ?? ''
}
