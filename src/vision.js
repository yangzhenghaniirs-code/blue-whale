// 桌宠的「视觉」：AIRI 截屏或收到图片时，请视觉模型写一段文字描述，再把描述放进聊天给角色参考
// 这里用 DSH 自己的模型看图（ctx.llm），不经过角色的会话，所以截图不会进聊天记录
//   图片先交给 ctx.attachments 存成附件，再作为 image 块发给模型
import { log } from './state.js'

// OpenAI 格式里带 image_url 的就是看图请求
export function isVisionRequest(body) {
  return (body?.messages || []).some((m) => Array.isArray(m.content) && m.content.some((p) => p?.type === 'image_url'))
}

function textOf(content) {
  if (typeof content === 'string') return content
  return (content || []).filter((p) => p?.type === 'text').map((p) => p.text).join('\n')
}

// data:image/png;base64,xxxx → { mediaType, data }
function parseDataUrl(url) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(url || ''))
  if (!m) return null
  const data = m[2] ? m[3] : Buffer.from(decodeURIComponent(m[3])).toString('base64')
  return { mediaType: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], data }
}

// 要试的模型路由：填了 visionProvider 就只用它；没填就按 DSH 的顺序挨个试，上次成功的排最前
let lastGood = ''
function providersToTry(llm, cfg) {
  if (cfg.visionProvider) return [cfg.visionProvider]
  const ids = (llm.listProviders?.() || []).map((p) => (typeof p === 'string' ? p : p?.id)).filter(Boolean)
  return lastGood && ids.includes(lastGood) ? [lastGood, ...ids.filter((id) => id !== lastGood)] : ids
}

// 跑一次模型，返回文字；没有文字时把 finish 分片里的原因记下来
async function runOnce(llm, provider, model, content) {
  let text = ''
  let finish
  for await (const chunk of llm.stream({ provider, model, messages: [{ role: 'user', content }] }, AbortSignal.timeout(60000))) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish' || chunk.type === 'error') finish = chunk
  }
  if (!text.trim()) throw new Error(`${provider} 没有返回文字：${JSON.stringify(finish ?? null).slice(0, 300)}`)
  return text.trim()
}

export async function describeImages(ctx, cfg, body) {
  const llm = ctx.get('llm')
  const attachments = ctx.get('attachments')
  if (!llm || !attachments) throw new Error('DSH 里找不到 llm 或 attachments 服务')

  // system 提示词和用户文字放在最前面，图片按原顺序跟在后面
  const parts = []
  const system = (body.messages || []).filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n').trim()
  if (system) parts.push({ type: 'text', text: system })
  for (const m of body.messages || []) {
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') {
      if (m.content.trim()) parts.push({ type: 'text', text: m.content })
      continue
    }
    for (const p of m.content || []) {
      if (p?.type === 'text' && p.text?.trim()) parts.push({ type: 'text', text: p.text })
      else if (p?.type === 'image_url') {
        const image = parseDataUrl(p.image_url?.url ?? p.image_url)
        if (image) parts.push({ type: 'image', ...image })
      }
    }
  }
  if (!parts.some((p) => p.type === 'image')) throw new Error('看图请求里没有能用的图片（只支持 data: 开头的图片）')

  const content = await attachments.admitPromptContent(parts)
  const errors = []
  for (const provider of providersToTry(llm, cfg)) {
    try {
      const text = await runOnce(llm, provider, cfg.visionModel, content)
      if (lastGood !== provider) log(`看图用的模型路由：${provider}`)
      lastGood = provider
      return text
    } catch (e) {
      errors.push(`${provider}：${e.message}`)
    }
  }
  throw new Error('所有模型路由都看不了图\n' + errors.join('\n'))
}
