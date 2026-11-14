// DSH 每次启动都存一条本机登录 Cookie（dsh-auth-*，30 天过期），攒到约 70 条时请求头超过 16KB，DSH 就打不开了
// DSH 运行时独占 Cookie 文件，所以由一个后台小进程等 DSH 退出后再清理，下次启动就恢复正常
// 这些 Cookie 下次启动会重新生成，清掉不影响账号和聊天；只清旧的，别的 Cookie 不动
// 既被插件 import，也被插件当独立脚本运行：node cookie-cleaner.js <DSH 主进程 pid> [Cookies 文件]
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const KEEP = 10
// 约 30 条的文件大小（清理后 10 条约 20KB）。文件小于这个数就不用开后台进程
const MIN_FILE_SIZE = 28 * 1024
const WAIT_EXIT_MS = 5000
const RETRY_MS = 2000
const RETRIES = 30

function defaultCookieFile() {
  return path.join(process.env.APPDATA || '', '@deepseek-ai', 'dsh-desktop', 'Network', 'Cookies')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

export async function pruneCookies(file) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(file)
  try {
    const { removed } = db.prepare(`
      SELECT count(*) AS removed FROM cookies
      WHERE host_key = '127.0.0.1' AND name LIKE 'dsh-auth-%' AND rowid NOT IN (
        SELECT rowid FROM cookies WHERE host_key = '127.0.0.1' AND name LIKE 'dsh-auth-%'
        ORDER BY creation_utc DESC LIMIT ${KEEP}
      )`).get()
    if (removed > 0) {
      db.exec(`
        DELETE FROM cookies
        WHERE host_key = '127.0.0.1' AND name LIKE 'dsh-auth-%' AND rowid NOT IN (
          SELECT rowid FROM cookies WHERE host_key = '127.0.0.1' AND name LIKE 'dsh-auth-%'
          ORDER BY creation_utc DESC LIMIT ${KEEP}
        )`)
    }
    // 缩小文件，不然 MIN_FILE_SIZE 的判断一直成立，每次启动都要开后台进程
    db.exec('VACUUM')
    return removed
  } finally {
    db.close()
  }
}

// 插件启动时调用：文件够大才开后台进程，出任何错都不影响 DSH
export function scheduleCookieCleanup(log = () => {}) {
  try {
    const file = defaultCookieFile()
    if (!fs.existsSync(file) || fs.statSync(file).size < MIN_FILE_SIZE) return
    const child = spawn(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), String(process.ppid), file], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    child.on('error', (e) => log('Cookie 清理进程启动失败：', e.message))
    child.unref()
  } catch (e) {
    log('安排 Cookie 清理失败：', e.message)
  }
}

async function main(pid, file) {
  while (isAlive(pid)) await sleep(WAIT_EXIT_MS)
  // DSH 的子进程可能还占着文件，多试几次；用户马上又打开 DSH 时就留到下次
  for (let i = 0; i < RETRIES; i++) {
    try {
      await pruneCookies(file)
      return
    } catch {
      await sleep(RETRY_MS)
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pid = Number(process.argv[2])
  if (pid > 0) await main(pid, process.argv[3] || defaultCookieFile())
}
