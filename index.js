// blue whale：住在 DeepSeek Harness 里的桌宠插件
//   1. 给桌宠（AIRI）一个 OpenAI 兼容接口，桌宠说的话交给你选的会话（src/server.js、src/dsh.js）
//      每句话开头带标签 [from the blue whale]（src/pet-rules.js）；默认还附上「桌宠规则.md」
//   2. DSH 启动时打开桌宠，退出时关掉（src/pet.js）
import os from 'node:os'
import path from 'node:path'
import { createServer } from './src/server.js'
import { createPetLauncher } from './src/pet.js'
import { scheduleCookieCleanup } from './src/cookie-cleaner.js'
import { log } from './src/state.js'
import { ROOT } from './src/state.js'
import fs from 'node:fs'

const BUNDLED_PET = [path.join(ROOT, '桌宠', 'airi.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'airi', 'airi.exe')].find((p) => fs.existsSync(p)) || path.join(ROOT, '桌宠', 'airi.exe')

export const inject = ['sessionController']

const DEFAULTS = {
  port: 18100,
  // 「切换聊天」选「新建会话」时，新会话建在这个文件夹（工作区）里
  workDir: path.join(os.homedir(), 'Documents', 'deepseek-harness', 'blue whale'),
  // 「切换聊天」列出所有工作区的会话（能接进 aurabot 等插件建的会话）；false 只列 workDir 里的
  allWorkspaces: true,
  // 桌宠说的话开头加的标签，角色靠它认出这是桌宠里当面说的
  petTag: '[from the blue whale]',
  // prompt = 每句话都附上「桌宠规则.md」；tag = 只带标签，规则由用户自己写进角色的人设或记忆
  ruleMode: 'prompt',
  // 桌宠程序：优先用插件文件夹里自带的「桌宠\airi.exe」（下载整包就能用），没有就用装在 Programs\airi 的
  airiExe: BUNDLED_PET,
  autoLaunchPet: true,
  closePetOnExit: true,
  timeoutSeconds: 180,
  fallbackReply: '我刚刚走神了，你再说一遍？',
  // 回复里没写动作时补一个；* 是通配符，由桌宠从所有「正常说话-xxx」里随机挑，新加的说话动作自动算进去
  idleMotions: ['Animation/正常说话-*.motion3.json'],
  // 换装表情换成换装动作，衣服才能一直保持
  outfitMotions: true,
  // 视觉：用 DSH 的哪个模型看图（要支持图片）；visionProvider 留空 = DSH 的第一个模型路由
  visionProvider: '',
  // DSH 内置目录里能看图的是 deepseek-flash；不在目录里的名字会被当成只能看字的模型
  visionModel: 'deepseek-flash',
  // 麦克风的辅助请求：local = 插件自己回答（不花钱），deepseek = 转发给 DeepSeek API
  helperMode: 'local',
  deepseekApiKey: '',
  deepseekUrl: 'https://api.deepseek.com',
  deepseekModel: 'deepseek-chat',
}

// DSH 设置里显示的配置表单；DSH 自带的 schemastery 读不到时只用默认值
let z
try {
  z = (await import('@deepseek-ai/schemastery')).default
} catch {}

export const Config = z
  ? z.object({
      port: z.natural().default(DEFAULTS.port).description('桌宠连接的端口（AIRI 意识模块填 http://127.0.0.1:端口/v1/）'),
      workDir: z.string().default(DEFAULTS.workDir).description('新建会话放在哪个文件夹（工作区）'),
      allWorkspaces: z.boolean().default(DEFAULTS.allWorkspaces).description('切换聊天时列出所有工作区的会话'),
      petTag: z.string().default(DEFAULTS.petTag).description('桌宠消息开头的标签'),
      ruleMode: z.union(['prompt', 'tag']).default(DEFAULTS.ruleMode).description('prompt：每句附上桌宠规则.md；tag：只带标签，规则自己贴进角色记忆'),
      airiExe: z.string().default(DEFAULTS.airiExe).description('桌宠程序 airi.exe 的位置'),
      autoLaunchPet: z.boolean().default(DEFAULTS.autoLaunchPet).description('DSH 启动时打开桌宠'),
      closePetOnExit: z.boolean().default(DEFAULTS.closePetOnExit).description('DSH 退出时关掉桌宠'),
      timeoutSeconds: z.natural().default(DEFAULTS.timeoutSeconds).description('等角色回复最多几秒'),
      fallbackReply: z.string().default(DEFAULTS.fallbackReply).description('出错时桌宠说的话'),
      idleMotions: z.array(z.string()).default(DEFAULTS.idleMotions).description('回复没写动作时补一个（可以用 * 通配符，由桌宠随机挑）'),
      outfitMotions: z.boolean().default(DEFAULTS.outfitMotions).description('换装用动作代替表情'),
      visionProvider: z.string().default('').description('视觉用的 DSH 模型路由（留空自动选第一个）'),
      visionModel: z.string().default(DEFAULTS.visionModel).description('视觉用的模型，要支持图片'),
      helperMode: z.union(['local', 'deepseek']).default(DEFAULTS.helperMode).description('麦克风辅助请求：local 本地回答，deepseek 转发'),
      deepseekApiKey: z.string().role('secret').default('').description('helperMode 为 deepseek 时用的 API Key'),
      deepseekUrl: z.string().default(DEFAULTS.deepseekUrl),
      deepseekModel: z.string().default(DEFAULTS.deepseekModel),
    })
  : undefined

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }
  cfg.workDir = path.resolve(cfg.workDir)

  const server = createServer(ctx, cfg)
  const pet = createPetLauncher(cfg)

  server.start()
  scheduleCookieCleanup(log)
  if (cfg.autoLaunchPet) pet.start().catch((e) => log('✗ 打开桌宠出错：', e))
  log('blue whale插件已启动', { port: cfg.port, autoLaunchPet: cfg.autoLaunchPet })
  try {
    log('DSH 可用的模型路由：', ctx.get('llm')?.listProviders?.() ?? '（没有 llm 服务）')
  } catch (e) {
    log('读取模型路由失败：', e.message)
  }

  ctx.effect(() => async () => {
    pet.stop()
    await server.stop()
    log('blue whale插件已停止')
  }, 'dafei: server and pet')
}
