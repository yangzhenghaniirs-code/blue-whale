// 把 markdown 回复变成适合朗读的纯文字：去掉代码块、markdown 符号、网址和 emoji

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu
const END_PUNCT = /[。！？!?；;，,、：:…~]$/
// AIRI 的控制标记：<|ACT {...}|>、<|DELAY 1|> 等，要原样保留
const MARKER = /<\|[\s\S]*?\|>/g
// 清洗时先把标记换成占位符（私用区字符 + 序号），免得被当成 markdown 处理，最后再换回来
const PLACEHOLDER = /(\d+)/g

export function cleanForSpeech(input) {
  const markers = []
  let s = String(input ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(MARKER, (m) => `${markers.push(m) - 1}`)
    .replace(/```[\s\S]*?(```|$)/g, ' ') // 代码块整段去掉（包括没闭合的）
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 图片 → 替代文字
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 链接 → 链接文字
    .replace(/https?:\/\/\S+/g, ' ') // 裸网址不念
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ') // HTML 标签
    .replace(/`([^`]*)`/g, '$1') // 行内代码保留内容
    .replace(EMOJI, '')

  const lines = s
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/, '') // 表格分隔行、分隔线 ---
        .replace(/^\s*([*_]\s*){3,}$/, '') // 分隔线 *** ___
        .replace(/^\s{0,3}(#{1,6}|>+)\s*/, '') // 标题、引用
        .replace(/^\s*([-*+]|\d+[.)])\s+/, '') // 列表符号
        .replace(/(\*\*|__)(.+?)\1/g, '$2') // 粗体
        .replace(/~~/g, '')
        .replace(/\*/g, '')
        .replace(/\s*\|\s*/g, '，') // 表格竖线
        .replace(/^[\s，]+|[\s，]+$/g, '')
        .trim(),
    )
    .filter(Boolean)

  // 多行合成一段：没有标点结尾的行补一个句号，读起来有停顿（只有标记的行不补）
  s = lines
    .map((l, i) => {
      const bare = l.replace(PLACEHOLDER, '').trim()
      return i < lines.length - 1 && bare && !END_PUNCT.test(bare) ? l + '。' : l
    })
    .join('')

  return s
    .replace(/[ \t　]+/g, ' ')
    .replace(/[，,]\s*([。！？!?])/g, '$1')
    .replace(/([。！？!?])\1+/g, '$1')
    .trim()
    .replace(PLACEHOLDER, (_, i) => markers[i])
    .replace(/<\|DELAY[\s\S]*?\|>/gi, '') // 延迟标记不读出来，剔除
}

// 按句子切开，流式返回时一句一句发；<|...|> 标记整体当一个字处理，不会被切开
export function splitSentences(text) {
  return text.match(/(?:<\|[\s\S]*?\|>|[^。！？!?；;\n])+[。！？!?；;]*/g) || []
}
