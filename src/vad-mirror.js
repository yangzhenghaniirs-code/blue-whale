// 打开桌宠前对桌宠程序（app.asar）做的小修补，都是「同样长度原位替换」，不用重新下载桌宠
//   1. 国内能用的语音检测模型
//      桌宠听你说话前，要先用 Silero 小模型判断「有没有人在说话」，这个模型原本从 huggingface.co 下载，国内连不上，
//      听力就会卡在「Loading…」或报「Failed to fetch」「Audio detector fell behind」。
//      插件自带模型文件（assets/silero-vad.onnx），在本机 127.0.0.1:18101 提供下载；其它文件转回 huggingface.co；
//      桌宠里的下载地址 https://huggingface.co/ 换成 http://127.0.0.1:18101/（都是 23 个字符）
//   2. 屏幕边缘不再抢鼠标（0.3.3）
//      原版鼠标离窗口边缘 10 像素内时窗口会接住鼠标（给拉伸窗口用），桌宠窗口铺满屏幕，窗口边缘就是屏幕边缘，
//      在屏幕最边上按住拖会拖到大肥。改成不看边缘，边缘和别的透明处一样点得穿
//   3. 托盘「显示 / 隐藏桌宠」真的能隐藏（0.3.5，见 TRAY_OLD）
// 改回去：把下面每条的 to 换回 from 即可
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { log } from './state.js'

// DSH 的插件跑在 Electron 里，Electron 的 fs 会把 .asar 当成文件夹，打不开 app.asar 这个文件本身；
// 改桌宠程序要用 Electron 留的原版 fs（original-fs），普通 Node 里没有它就用 fs
const rawFs = (() => {
  try {
    return createRequire(import.meta.url)('original-fs')
  } catch {
    return fs
  }
})()

export const VAD_PORT = 18101
const MODEL_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'silero-vad.onnx')
const MODEL_PATH = '/onnx-community/silero-vad/resolve/main/onnx/model.onnx'

const BORDER_OLD = 'const nearBorder = isAroundWindowBorder.value || isAroundWindowBorderFor250Ms.value;'
const BORDER_NEW = 'const nearBorder = false;'
// 托盘菜单「显示 / 隐藏桌宠」（0.3.5）：原来点它只会显示（toggleWindowShow 只 show），改成看得见就隐藏、看不见就显示
// 新写法要塞进原来的字节数里，所以写得很紧凑、菜单名改成「显示/隐藏桌宠」；w 用默认参数拿到桌宠窗口（Electron 点菜单只传前三个参数）
const TRAY_OLD = '\t\t\t{\n\t\t\t\tlabel: "显示 / 隐藏桌宠",\n\t\t\t\tclick: () => toggleWindowShow(params.mainWindow)\n\t\t\t}'
const TRAY_NEW = '{label:"显示/隐藏桌宠",click:(a,b,c,w=params.mainWindow)=>w.isVisible()?w.hide():w.show()}'
// 屏幕四个角也点得穿（0.4.2）：舞台外框有 16 像素圆角并裁掉溢出，角上测到的是外框不是画布，窗口就接住了鼠标、按住拖到大肥。
// 改成测到包着画布的外框也算在画布上；新代码比原来长，把前面那段英文注释一起换掉腾出位置
const CORNER_OLD = '/**\n\t\t* Whether the cursor sits on the stage canvas rather than on interface drawn over it.\n\t\t*\n\t\t* The pixel test can only answer for the canvas, and the canvas draws nothing beneath a\n\t\t* DOM overlay, so a button, a toast or a portaled panel floating over blank canvas\n\t\t* would read as empty space and lose its clicks. Ask the document what is really under\n\t\t* the cursor instead. This is a hit test, not an event, so it still answers while the\n\t\t* window is click-through.\n\t\t*/\n\t\tconst isPointerOverStageCanvas = computed(() => document.elementFromPoint(relativeMouseX.value, relativeMouseY.value) === stageCanvas.value);'
const CORNER_NEW = 'const isPointerOverStageCanvas = computed(() => { const hit = document.elementFromPoint(relativeMouseX.value, relativeMouseY.value); return hit === stageCanvas.value || !!(hit && stageCanvas.value && hit.contains(stageCanvas.value)); });'
// 每条：名字、原文、换成什么（按字节算长度必须一样；短了就在最后一个字符前补空格）
const PET_PATCHES = [
  ['语音检测模型地址换成本机', 'remoteHost: "https://huggingface.co/"', `remoteHost: "http://127.0.0.1:${VAD_PORT}/"`],
  ['屏幕边缘不再抢鼠标', BORDER_OLD, BORDER_NEW],
  ['托盘显示/隐藏能隐藏', TRAY_OLD, TRAY_NEW],
  ['屏幕四个角也点得穿', CORNER_OLD, CORNER_NEW],
].map(([name, from, to]) => {
  const f = Buffer.from(from)
  const short = f.length - Buffer.byteLength(to)
  const t = Buffer.from(short > 0 ? to.slice(0, -1) + ' '.repeat(short) + to.slice(-1) : to)
  if (f.length !== t.length) throw new Error(`修补「${name}」前后长度不一致`)
  return { name, from: f, to: t }
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Expose-Headers': 'Content-Length, ETag',
}

// 本机的小下载站：只认语音检测模型，其它请求转回 huggingface.co（和原来一样）
export function startModelServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      return res.end()
    }
    if (url.pathname === MODEL_PATH && fs.existsSync(MODEL_FILE)) {
      const size = fs.statSync(MODEL_FILE).size
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/octet-stream', 'Content-Length': size, ETag: '"silero-vad-bundled"' })
      if (req.method === 'HEAD') return res.end()
      return fs.createReadStream(MODEL_FILE).pipe(res)
    }
    res.writeHead(302, { ...CORS, Location: 'https://huggingface.co' + url.pathname + url.search })
    res.end()
  })
  server.on('error', (e) => log('✗ 语音检测模型服务没启动（端口 ' + VAD_PORT + '）：', e.message))
  server.listen(VAD_PORT, '127.0.0.1', () => log('语音检测模型服务已启动：http://127.0.0.1:' + VAD_PORT))
  return {
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

// 在 app.asar 里找出所有位置（分块读，不把 500MB 一次读进内存）
function findAll(fd, size, needles) {
  const longest = Math.max(...needles.map((n) => n.length))
  const CHUNK = 32 * 1024 * 1024
  const buf = Buffer.alloc(CHUNK + longest)
  const hits = needles.map(() => [])
  for (let pos = 0; pos < size; pos += CHUNK) {
    const n = rawFs.readSync(fd, buf, 0, Math.min(CHUNK + longest - 1, size - pos), pos)
    const view = buf.subarray(0, n)
    needles.forEach((needle, k) => {
      for (let i = view.indexOf(needle); i !== -1; i = view.indexOf(needle, i + 1)) {
        if (i < CHUNK) hits[k].push(pos + i)
      }
    })
  }
  return hits
}

// 打开桌宠前修补桌宠程序；已经改过的就跳过
export function patchPet(airiExe) {
  const asar = path.join(path.dirname(airiExe), 'resources', 'app.asar')
  if (!rawFs.existsSync(asar)) return log('找不到桌宠的 app.asar，跳过修补：', asar)
  // 检查过的 app.asar 记下大小和修改时间，没变就不再扫一遍 500MB；修补项变了就换个记号文件名，重新检查一次
  const mark = asar + '.patches-v4'
  const stamp = (st) => `${st.size}:${Math.floor(st.mtimeMs)}`
  try {
    if (rawFs.readFileSync(mark, 'utf8') === stamp(rawFs.statSync(asar))) return
  } catch {}
  let fd
  try {
    fd = rawFs.openSync(asar, 'r+')
    const size = rawFs.fstatSync(fd).size
    const hits = findAll(fd, size, PET_PATCHES.flatMap((p) => [p.from, p.to]))
    PET_PATCHES.forEach((p, k) => {
      const todo = hits[k * 2]
      const done = hits[k * 2 + 1].length
      for (const at of todo) rawFs.writeSync(fd, p.to, 0, p.to.length, at)
      log(todo.length ? `已修补桌宠：${p.name}（${todo.length} 处）` : done ? `桌宠已经修补过：${p.name}` : `桌宠里没找到要修补的地方，跳过：${p.name}`)
    })
    rawFs.closeSync(fd)
    fd = undefined
    rawFs.writeFileSync(mark, stamp(rawFs.statSync(asar)))
  } catch (e) {
    log('✗ 修补桌宠失败（桌宠开着时改不了，关掉桌宠后重启 DSH 会再试）：', e.message)
  } finally {
    if (fd !== undefined) rawFs.closeSync(fd)
  }
}
