// 第一次用时自动下载桌宠：npm 上的插件只有几十 KB，桌宠程序（带大肥鱼模型）约 485MB，放在 Gitee / GitHub 的发行版里
// 顺序：先 Gitee（国内快，6 个分卷），不行再 GitHub（整包）；下完核对 SHA-256，解压出 桌宠\ 放到 ~/.dsh/blue-whale/pet-<版本>\
// 下到一半断了：已经下好的分卷下次接着用；整包对不上就删掉重下
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { log } from './state.js'

// DSH 的插件跑在 Electron 里，它的 fs 把 app.asar 当成文件夹；删、挪桌宠文件夹要用原版 fs
const rawFs = (() => {
  try {
    return createRequire(import.meta.url)('original-fs')
  } catch {
    return fs
  }
})()

// 要下的桌宠版本。换了桌宠就改这里（大小、指纹、地址都要一起改）
export const PET = {
  version: '0.4.0',
  size: 508033039,
  sha256: '41e192742faf3448522903773c513b6883b28e14b70a882eec3730450a41cf4f',
  // 包里桌宠所在的文件夹
  inner: path.join('blue-whale', '桌宠'),
  sources: [
    {
      name: 'Gitee',
      parts: [1, 2, 3, 4, 5, 6].map((i) => `https://gitee.com/yangzhenghan/blue-whale/releases/download/v0.4.0/blue-whale-v0.4.0.zip.00${i}`),
    },
    {
      name: 'GitHub',
      parts: ['https://github.com/yangzhenghaniirs-code/blue-whale/releases/download/v0.4.0/blue-whale-v0.4.0.zip'],
    },
  ],
}

export const PET_HOME = path.join(os.homedir(), '.dsh', 'blue-whale')
export const PET_DIR = path.join(PET_HOME, `pet-${PET.version}`)
export const PET_EXE = path.join(PET_DIR, '桌宠', 'airi.exe')

let running = null

// 已经有桌宠就直接返回路径；没有就下载（同一时间只下一份）
export function ensurePet(notify = () => {}) {
  if (fs.existsSync(PET_EXE)) return Promise.resolve(PET_EXE)
  running ??= download(notify).finally(() => { running = null })
  return running
}

async function download(notify) {
  const work = path.join(PET_HOME, `download-${PET.version}`)
  fs.mkdirSync(work, { recursive: true })
  const zip = path.join(work, 'pet.zip')
  notify(`blue whale：第一次使用，正在下载桌宠（约 ${Math.round(PET.size / 1048576)}MB），下好后会自动出来`)
  log('开始下载桌宠', PET.version)

  let ok = false
  for (const source of PET.sources) {
    try {
      await fetchSource(source, work, zip)
      if (await sha256(zip) !== PET.sha256) throw new Error('文件指纹对不上（下载不完整或被改过）')
      ok = true
      log(`桌宠从 ${source.name} 下载完成`)
      break
    } catch (e) {
      log(`从 ${source.name} 下载桌宠失败：`, e.message || e)
      fs.rmSync(zip, { force: true })
    }
  }
  if (!ok) {
    notify('blue whale：桌宠下载失败，请检查网络后重启 DeepSeek Harness 再试；也可以到 Gitee / GitHub 手动下载安装包')
    throw new Error('桌宠下载失败')
  }

  notify('blue whale：桌宠下载好了，正在解压……')
  const unpack = path.join(work, 'unpack')
  fs.rmSync(unpack, { recursive: true, force: true })
  fs.mkdirSync(unpack, { recursive: true })
  await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', unpack])
  const inner = path.join(unpack, PET.inner)
  if (!fs.existsSync(path.join(inner, 'airi.exe'))) throw new Error('解压后找不到 airi.exe（可能被杀毒软件删了）')
  rawFs.rmSync(PET_DIR, { recursive: true, force: true })
  rawFs.mkdirSync(PET_DIR, { recursive: true })
  rawFs.renameSync(inner, path.join(PET_DIR, '桌宠'))
  rawFs.rmSync(work, { recursive: true, force: true })
  // 旧版本的桌宠用不到了，删掉省空间（删不掉也不影响新桌宠，比如旧桌宠还开着）
  for (const name of rawFs.readdirSync(PET_HOME)) {
    if (!/^pet-/.test(name) || name === path.basename(PET_DIR)) continue
    try {
      rawFs.rmSync(path.join(PET_HOME, name), { recursive: true, force: true })
    } catch (e) {
      log('删旧桌宠失败（不影响使用）：', name, e.message)
    }
  }
  log('桌宠已装好：', PET_EXE)
  notify('blue whale：桌宠装好了')
  return PET_EXE
}

// 按顺序下每个分卷，接到 zip 后面；已经下完整的分卷（.done 记着大小）不重下
async function fetchSource(source, work, zip) {
  const files = []
  for (const [i, url] of source.parts.entries()) {
    const file = path.join(work, `${source.name}-${i + 1}.part`)
    const done = file + '.done'
    if (!(fs.existsSync(done) && fs.existsSync(file) && fs.statSync(file).size === Number(fs.readFileSync(done, 'utf8')))) {
      fs.rmSync(done, { force: true })
      await fetchFile(url, file)
      fs.writeFileSync(done, String(fs.statSync(file).size))
    }
    files.push(file)
    log(`${source.name} 第 ${i + 1}/${source.parts.length} 份下好了`)
  }
  fs.rmSync(zip, { force: true })
  for (const file of files) fs.appendFileSync(zip, fs.readFileSync(file))
  if (fs.statSync(zip).size !== PET.size) throw new Error(`大小不对：${fs.statSync(zip).size}，应该是 ${PET.size}`)
  for (const file of files) { fs.rmSync(file, { force: true }); fs.rmSync(file + '.done', { force: true }) }
}

async function fetchFile(url, file) {
  // 30 秒连不上、或者 60 秒一点数据都没收到，就算这一路失败
  const ctrl = new AbortController()
  let timer = setTimeout(() => ctrl.abort(), 30e3)
  const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'dsh-bluewhale' } })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}：${url}`)
  const out = fs.createWriteStream(file)
  try {
    for await (const chunk of res.body) {
      clearTimeout(timer)
      timer = setTimeout(() => ctrl.abort(), 60e3)
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
    }
  } finally {
    clearTimeout(timer)
    await new Promise((r) => out.end(r))
  }
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject)
  })
}

function run(exe, args) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, maxBuffer: 1 << 24 }, (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()))
  })
}

// Windows 右下角弹通知（不用装任何东西）；失败就只记日志
export function toast(text) {
  log(text)
  const xml = `<toast><visual><binding template="ToastGeneric"><text>${text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)}</text></binding></visual></toast>`
  const script = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$x.LoadXml('${xml.replace(/'/g, "''")}')`,
    // 借用 PowerShell 的应用 ID，通知才能显示出来
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))",
  ].join('; ')
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, () => {})
}
