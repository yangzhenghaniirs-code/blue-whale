// 后续消息：桌宠说完一句后，会话里又冒出来的话（提醒到点补的一句、aurabot 主动搭话等）
// 桌宠是「问一句等一句」，这些话不在它等的那一轮里，所以插件先存起来，等桌宠来取
//   桌宠发来一句话 → 打开 WINDOW_MS 的窗口，清掉旧的待说
//   窗口里，同一个会话结束的一轮，只要不是有人打字发起的（桌宠和 DSH 窗口都算打字，来源 kind=user），回复就存进待说
//   桌宠 5 秒后每 2 秒问一次 GET /dafei/pending，有的话发一个通知请求（内容含 PENDING_MARK），插件把待说整段交给它念
import { loadState, log } from './state.js'

export const PENDING_MARK = '[dafei-pending]'
const WINDOW_MS = 75 * 1000

export function createFollowups(ctx, { prepare }) {
  let until = 0
  let pending = []
  const turns = new Map() // turn → { typed, texts }

  function open() {
    until = Date.now() + WINDOW_MS
    pending = []
  }

  let lastStarted = null

  function onEvent(session, e) {
    if (!e || !session?.id || session.id !== loadState().sessionId) return
    if (e.type === 'turn/start') lastStarted = e.data?.turn ?? lastStarted
    // user/message 有时不带轮次编号，算在刚开始的那一轮（和 dsh.js 一样）
    const turn = e.data?.turn ?? (e.type === 'user/message' ? lastStarted : undefined)
    if (turn === undefined || turn === null) return
    let t = turns.get(turn)
    if (!t) {
      t = { typed: false, texts: [] }
      turns.set(turn, t)
      if (turns.size > 50) turns.delete(turns.keys().next().value)
    }
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') t.typed = true
    else if (e.type === 'assistant/message' && !e.data?.interrupted) {
      const text = (e.data?.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
      if (text) t.texts.push(text)
    } else if (e.type === 'turn/end') {
      turns.delete(turn)
      if (t.typed || e.data?.reason?.kind !== 'completed' || !t.texts.length || Date.now() > until) return
      const reply = prepare(t.texts.at(-1))
      if (!reply) return
      pending.push(reply)
      log('⤷ 后续消息，等桌宠来取：' + reply)
    }
  }

  const off = ctx.on('session/event', onEvent, { global: true })

  return {
    open,
    count: () => pending.length,
    // 桌宠这一句的回复已经正常交出去了：待说里同样的话删掉，免得念两遍
    forget(reply) {
      const bare = (s) => String(s || '').replace(/<\|[\s\S]*?\|>/g, '').trim()
      const before = pending.length
      pending = pending.filter((p) => bare(p) !== bare(reply))
      if (pending.length < before) log('⤷ 待说里有和这一句一样的话，删掉')
    },
    take() {
      const all = pending.join('')
      pending = []
      return all
    },
    dispose: () => off?.(),
  }
}
