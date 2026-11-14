// 在 DSH 内部和角色的会话说话：不用登录、不走网络
//   发话：ctx.sessionController.prompt()（和 DSH 网页里发消息是同一个接口）
//   收回复：监听 session/event，等这句话那一轮的 turn/end
// 一轮对话的事件顺序：turn/start → user/message → (assistant/message → 工具调用 …)× N → turn/end
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { loadState, saveState, log } from './state.js'
import { findWorkspaceId } from './sessions.js'

export class DshError extends Error {
  constructor(code, message) {
    super(message || code)
    this.code = code
  }
}

const codeOf = (e) => String(e?.code || e?.data?.code || e?.name || '')

// 新建会话：带 workspaceId 的会话会出现在 App 的工作区分组里
export async function createSession(ctx, cfg) {
  fs.mkdirSync(cfg.workDir, { recursive: true })
  const workspaceId = findWorkspaceId(cfg.workDir)
  const { sessionId } = await ctx.sessionController.create(workspaceId ? { workspaceId } : { cwd: cfg.workDir }, new AbortController().signal)
  saveState({ sessionId })
  log('新建会话', sessionId, workspaceId ? '' : '（没找到对应的工作区分组）')
  return sessionId
}

// 发一句话给角色，返回最终回复的原始文本
export async function ask(ctx, cfg, text) {
  const deadline = Date.now() + cfg.timeoutSeconds * 1000
  const sessionId = loadState().sessionId || (await createSession(ctx, cfg))
  try {
    return await askInSession(ctx, sessionId, text, deadline)
  } catch (e) {
    // 归档的会话会拒绝新消息（本轮以 blocked 结束）：不自动新建，让用户在托盘「切换聊天」里换
    if (e.code === 'TURN_BLOCKED') throw new DshError(e.code, '桌宠正在用的会话拒绝了新消息（多半被归档了），请在托盘「切换聊天」里换一个')
    // 存的会话被删了：新建一个再试一次
    if (!/not-found/i.test(codeOf(e))) throw e
    log('旧会话不存在了，重新创建')
    return await askInSession(ctx, await createSession(ctx, cfg), text, deadline)
  }
}

function askInSession(ctx, sessionId, text, deadline) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    let done = false
    let firstTurn = null // 发话后看到的第一个轮次（找不到自己那条消息时用它）
    let myTurn = null // 这句话所在的轮次
    let lastStarted = null
    const replies = [] // 这一轮里每一步的助手文字，最后一条是给用户的回复

    const timer = setTimeout(() => finish(new DshError('TIMEOUT', '等待角色回复超时')), Math.max(0, deadline - Date.now()))
    const off = ctx.on('session/event', (session, event) => {
      if (session?.id === sessionId) handleEvent(event)
    }, { global: true })

    function finish(err, value) {
      if (done) return
      done = true
      clearTimeout(timer)
      off?.()
      err ? reject(err) : resolve(value)
    }

    function handleEvent(e) {
      if (!e || done) return
      const turn = e.data?.turn
      if (e.type === 'turn/start') {
        lastStarted = turn
        if (firstTurn === null) firstTurn = turn
      }
      if (e.type === 'user/message' && e.data?.source?.rpcId === requestId) myTurn = turn ?? lastStarted
      const mine = myTurn ?? firstTurn
      if (mine === null || turn !== mine) return

      if (e.type === 'assistant/message' && !e.data.interrupted) {
        const t = textOf(e.data.message)
        if (t) replies.push(t)
      } else if (e.type === 'turn/end') {
        const kind = e.data.reason?.kind
        if (kind === 'completed' && replies.length) finish(null, replies.at(-1))
        else finish(new DshError('TURN_' + String(kind).toUpperCase(), `角色这一轮结束了但没有正常回复（${kind}）`))
      }
    }

    // 第二个参数是取消信号（DSH 的接口都要），这里不取消
    ctx.sessionController
      .prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
      .catch((e) => finish(Object.assign(new DshError(codeOf(e) || 'PROMPT_FAILED', e.message), { cause: e })))
  })
}

// 只取文字块，跳过思考过程和工具调用
function textOf(message) {
  return (message?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}
