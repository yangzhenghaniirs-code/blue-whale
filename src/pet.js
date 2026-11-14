// 桌宠（AIRI 特别版）跟着 DSH 开关：DSH 启动时打开，DSH 退出时关掉
// 桌宠已经开着就不重复打开；不是插件打开的桌宠，退出时也不去关
import fs from 'node:fs'
import { spawn, execFile } from 'node:child_process'
import { log } from './state.js'

function runPowerShell(script) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10000, windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

async function isRunning(exe) {
  const out = await runPowerShell(`(Get-Process -Name airi -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${exe.replace(/'/g, "''")}' } | Measure-Object).Count`)
  return Number(out.trim()) > 0
}

// DSH 的插件运行在「Electron 当 Node 用」的进程里（ELECTRON_RUN_AS_NODE=1）
// 这些变量传给 airi.exe 的话，它也会当成 Node 启动然后马上退出，所以要去掉
function cleanEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(ELECTRON_|NODE_OPTIONS$|NODE_PATH$|NODE_ENV$|DSH_)/i.test(key)) delete env[key]
  }
  return env
}

export function createPetLauncher(cfg) {
  let child = null

  return {
    async start() {
      if (!fs.existsSync(cfg.airiExe)) return log('找不到桌宠程序：', cfg.airiExe)
      if (await isRunning(cfg.airiExe)) return log('桌宠已经开着了')
      child = spawn(cfg.airiExe, [], { detached: true, stdio: 'ignore', windowsHide: false, env: cleanEnv() })
      child.on('error', (e) => log('打开桌宠失败：', e))
      child.unref()
      log('已打开桌宠，进程', child.pid)
    },
    stop() {
      if (!child?.pid || !cfg.closePetOnExit) return
      // /T 连同 AIRI 的子进程一起关
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
      log('已关闭桌宠')
      child = null
    },
  }
}
