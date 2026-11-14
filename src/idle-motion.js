// 每条回复换一个待机动作：回复里没有动作标记时，在开头补一个 <|ACT {"motion":...}|>
// 从 config.json 的 idleMotions 里随机挑，不和上一次重复

let last

export function withIdleMotion(reply, motions, random = Math.random) {
  if (!reply || !motions?.length) return reply
  // 角色自己写了动作就听角色的
  if (/<\|ACT\s[^|]*"motion"\s*:/.test(reply)) return reply
  const choices = motions.length > 1 ? motions.filter((m) => m !== last) : motions
  last = choices[Math.floor(random() * choices.length)]
  return `<|ACT ${JSON.stringify({ motion: last })}|>${reply}`
}
