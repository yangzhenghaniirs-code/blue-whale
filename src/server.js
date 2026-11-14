// 给 AIRI 用的 OpenAI 兼容接口（AIRI 的意识模块填 http://127.0.0.1:端口/v1/）
//   GET  /v1/models            → 一个模型 "dsh"
//   POST /v1/chat/completions  → 支持普通 JSON 和 stream: true（SSE）
// 桌宠托盘「切换聊天」用：
//   GET  /dafei/sessions       → { current, sessions: [{ id, title, active }] }
//   POST /dafei/session        → { id } 切到那个会话；{ new: true } 下一句话新建会话
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { ask } from './dsh.js'
import { listSessions } from './sessions.js'
import { loadState, saveState, log } from './state.js'
import { cleanForSpeech, splitSentences } from './clean-text.js'
import { isChatRequest, lastUserText, extractSpeech } from './route.js'
import { withIdleMotion } from './idle-motion.js'
import { withOutfitMotions } from './outfit.js'
import { localHelperReply, forwardToDeepSeek } from './helpers.js'
import { isVisionRequest, describeImages } from './vision.js'
import { createFollowups, PENDING_MARK } from './followups.js'
import { petMessage } from './pet-rules.js'

const MODEL = 'dsh'
// aurabot 等插件让角色「不说话」时写的标记
const SILENCE = /^\s*[[［(（]沉默[\]］)）]\s*$/

export function createServer(ctx, cfg) {
  // 角色的原始回复 → 桌宠念的文字（带动作标记）；`|||` 是 aurabot 分条的写法，当成一句结束
  function speakable(raw) {
    if (!raw || SILENCE.test(raw)) return ''
    const spoken = withOutfitMotions(cleanForSpeech(String(raw).replace(/\s*\|\|\|\s*/g, '。\n')), cfg.outfitMotions)
    return withIdleMotion(spoken, cfg.idleMotions)
  }
  const followups = createFollowups(ctx, { prepare: speakable })

  // 同一时间只让角色处理一句话，后来的排队
  let queue = Promise.resolve()
  const enqueue = (task) => {
    const result = queue.then(task, task)
    queue = result.catch(() => {})
    return result
  }

  async function chatReply(text) {
    if (!text) return cfg.fallbackReply
    const started = Date.now()
    log('← 收到：' + text)
    followups.open()
    try {
      const reply = speakable(await enqueue(() => ask(ctx, cfg, petMessage(text, cfg))))
      followups.forget(reply)
      log(`→ 回复（${((Date.now() - started) / 1000).toFixed(1)}s）：${reply}`)
      return reply || cfg.fallbackReply
    } catch (e) {
      // 报错只写日志，不返回给 AIRI
      log(`✗ 出错：[${e.code || 'ERROR'}]`, e)
      return cfg.fallbackReply
    }
  }

  async function visionReply(body) {
    const started = Date.now()
    try {
      const text = await describeImages(ctx, cfg, body)
      log(`👁 看图（${((Date.now() - started) / 1000).toFixed(1)}s）：${text.slice(0, 80)}`)
      return text
    } catch (e) {
      log('✗ 看图出错：', e)
      return ''
    }
  }

  async function helperReply(body) {
    const text = lastUserText(body)
    if (cfg.helperMode === 'deepseek' && cfg.deepseekApiKey) {
      try {
        return await forwardToDeepSeek(body, cfg)
      } catch (e) {
        log('✗ 辅助请求转发失败，改为本地回答：', e.message)
      }
    }
    return localHelperReply(body, text)
  }

  async function chatCompletions(req, res) {
    let body
    try {
      const raw = await readText(req)
      body = raw ? JSON.parse(raw) : {}
    } catch {
      return sendJson(res, 400, { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } })
    }

    // 桌宠来取后续消息（通知请求，内容含 PENDING_MARK）：直接交出存着的话，不发给角色
    const pendingRequest = lastUserText(body).includes(PENDING_MARK)
    if (pendingRequest) log(`⤷ 桌宠取走后续消息（${followups.count()} 条）`)
    const reply = pendingRequest
      ? followups.take()
      : isVisionRequest(body)
      ? await visionReply(body)
      : isChatRequest(body)
        ? await chatReply(extractSpeech(lastUserText(body)))
        : await helperReply(body)
    const id = 'chatcmpl-' + randomUUID()
    const created = Math.floor(Date.now() / 1000)

    if (!body.stream) {
      return sendJson(res, 200, {
        id,
        object: 'chat.completion',
        created,
        model: MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })
    }

    // 流式：角色一整轮说完才有回复，所以一句一句发出去
    if (res.destroyed) return
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    res.write(chunk({ role: 'assistant', content: '' }))
    for (const sentence of splitSentences(reply)) res.write(chunk({ content: sentence }))
    res.write(chunk({}, 'stop'))
    res.end('data: [DONE]\n\n')
  }

  async function switchSession(req, res) {
    let body = {}
    try {
      body = JSON.parse((await readText(req)) || '{}')
    } catch {}
    if (body.new) {
      saveState({ sessionId: null })
      return sendJson(res, 200, { ok: true, current: null })
    }
    const s = listSessions(cfg.workDir, cfg.allWorkspaces).find((x) => x.id === body.id)
    if (!s) return sendJson(res, 404, { ok: false, error: `找不到会话 ${body.id}` })
    saveState({ sessionId: s.id })
    log(`切换会话：${s.title}`)
    return sendJson(res, 200, { ok: true, current: s.id })
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()

    // 兼容 /v1/models、/v1//models、/models 等写法
    const path = new URL(req.url, 'http://x').pathname.replace(/\/+/g, '/').replace(/\/$/, '')
    const api = path.replace(/^\/v1/, '')
    try {
      if (req.method === 'GET' && api === '/models') {
        return sendJson(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model', created: 0, owned_by: 'dsh-dafei' }] })
      }
      if (req.method === 'POST' && api === '/chat/completions') return await chatCompletions(req, res)
      if (req.method === 'GET' && path === '/dafei/sessions') {
        return sendJson(res, 200, { current: loadState().sessionId || null, sessions: listSessions(cfg.workDir, cfg.allWorkspaces) })
      }
      if (req.method === 'POST' && path === '/dafei/session') return await switchSession(req, res)
      if (req.method === 'GET' && path === '/dafei/pending') return sendJson(res, 200, { count: followups.count() })
      if (req.method === 'GET' && path === '/dafei/health') return sendJson(res, 200, { ok: true })
      sendJson(res, 404, { error: { message: `Not found: ${req.method} ${req.url}`, type: 'invalid_request_error' } })
    } catch (e) {
      log('✗ 处理请求出错：', e)
      if (!res.headersSent) sendJson(res, 500, { error: { message: 'internal error', type: 'server_error' } })
      else res.end()
    }
  })

  // 端口被占（比如旧特别版的桥还开着）就每 10 秒再试一次
  let retryTimer = null
  let closed = false
  const listen = () => server.listen(cfg.port, '127.0.0.1')
  server.on('listening', () => log(`角色接口已启动：http://127.0.0.1:${cfg.port}/v1`))
  server.on('error', (e) => {
    if (e.code !== 'EADDRINUSE' || closed) return log('✗ 接口出错：', e)
    log(`端口 ${cfg.port} 被占用了，10 秒后再试（是不是旧的 dsh-bridge 还开着？）`)
    retryTimer = setTimeout(listen, 10000)
  })

  return {
    start: listen,
    stop() {
      closed = true
      followups.dispose()
      clearTimeout(retryTimer)
      server.closeAllConnections?.()
      return new Promise((r) => server.close(() => r()))
    },
  }
}

function readText(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}
