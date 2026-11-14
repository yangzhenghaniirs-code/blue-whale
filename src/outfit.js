// 换装用动作代替表情：AIRI 同一时间只有一个表情，换装表情会被下一个表情清掉
// 把换装表情换成同名的换装动作（Animation/换装-xxx.motion3.json），衣服就能一直保持
// 换回原样的 {"expression":null} 换成「换装-全部还原」；单件换回用穿鞋、短裙这些名字（模型里没有这些表情，只有动作）

const OUTFITS = new Set([
  '长裙', '中号', '小号', '大号', '脱鞋', '尾巴开关', '胸口衣服',
  '穿鞋', '短裙', '放出尾巴', '换回胸口衣服',
])
// 旧名字：裙子切换 = 换长裙，换回裙子 = 换短裙，体型1/体型2/默认体型 = 中号/小号/大号
const ALIASES = { 裙子切换: '长裙', 换回裙子: '短裙', 体型1: '中号', 体型2: '小号', 默认体型: '大号' }
const outfitMotion = (name) => `Animation/换装-${name}.motion3.json`

export function withOutfitMotions(reply, enabled) {
  if (!reply || !enabled) return reply
  return reply.replace(/<\|ACT\s+([\s\S]*?)\|>/g, (tag, body) => {
    let act
    try {
      act = JSON.parse(body)
    } catch {
      return tag
    }
    if (!act || typeof act !== 'object' || !('expression' in act)) return tag
    const { expression, ...rest } = act
    let name
    if (expression === null) name = '全部还原'
    else if (OUTFITS.has(expression?.name)) name = expression.name
    else if (ALIASES[expression?.name]) name = ALIASES[expression.name]
    else return tag
    // 换装动作里带着说话晃动，同一个标记里角色写的姿势让给换装
    return `<|ACT ${JSON.stringify({ ...rest, motion: outfitMotion(name) })}|>`
  })
}
