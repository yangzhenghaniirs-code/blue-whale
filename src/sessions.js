// 列出会话，给桌宠右键菜单「切换聊天」用
// 只读 DSH 自己的存储文件，不打开会话，所以很快
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STORAGE = path.join(os.homedir(), '.dsh', 'storages')
const CACHE_DIR = path.join(STORAGE, 'session_projcache', 'sessions')

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

function readWorkspaces() {
  try {
    return JSON.parse(fs.readFileSync(path.join(STORAGE, 'workspace.json'), 'utf8'))
  } catch {
    return {}
  }
}

// workDir 对应 App 里的哪个工作区（分组）
export function findWorkspaceId(workDir) {
  const { tables } = readWorkspaces()
  return Object.entries(tables?.workspaces || {}).find(([, w]) => same(w.path, workDir))?.[0]
}

// 菜单最多列这么多个（最近用过的）
const MAX_SESSIONS = 30

// 最近用过的在前：[{ id, title, active }]
// allWorkspaces = true：所有工作区的会话都列出来，标题前加工作区名（比如「Aurabot · QQ · 和主人的私聊」），
//   这样能切到别的插件（aurabot 等）建的会话，用它们自己的人设和记忆；false：只列 workDir 里的
export function listSessions(workDir, allWorkspaces = true) {
  const ws = readWorkspaces()
  const archived = new Set(ws.global?.archivedSessionIds || [])
  const spaces = Object.values(ws.tables?.workspaces || {})
  const spaceName = (cwd) => spaces.find((w) => w.path && same(w.path, cwd))?.title || path.basename(cwd)
  const sessions = []
  for (const f of fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : []) {
    const file = path.join(CACHE_DIR, f)
    try {
      const { record } = JSON.parse(fs.readFileSync(file, 'utf8'))
      const id = f.replace(/\.json$/, '')
      const cwd = record.identity.cwd
      if (archived.has(id) || (!allWorkspaces && !same(cwd, workDir))) continue
      const title = String(record.rows.title?.val || record.rows.titleInput?.val?.first?.text || '（无标题）').slice(0, 30)
      sessions.push({ id, title: allWorkspaces ? `${spaceName(cwd)} · ${title}` : title, active: fs.statSync(file).mtime.getTime() })
    } catch {}
  }
  return sessions.sort((a, b) => b.active - a.active).slice(0, MAX_SESSIONS)
}
