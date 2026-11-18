// 「每句附上桌宠规则」开关：DSH 插件页里 blue whale 下面的第二个组件
//   打开 = 桌宠说的每句话都附上「桌宠规则.md」（prompt 模式），不用改角色记忆
//   关上 = 只带标签（tag 模式），规则要写在角色记忆里
// 两个组件之间用 globalThis 上的一个标记传话（插件热更新后也是同一个）
const KEY = Symbol.for('bluewhale.promptRules')

export function apply(ctx) {
  ctx.effect(() => {
    globalThis[KEY] = true
    return () => {
      globalThis[KEY] = false
    }
  }, 'bluewhale: prompt rules switch')
}
