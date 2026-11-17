/**
 * 文本处理：中英混合分词 + 归一化
 * ------------------------------------------------------------------
 * 不引入 jieba 等重型词典依赖，改用「中文二元组 + 英文/数字词」方案：
 *  - 医疗术语多为 2~4 字复合词（华法林 / 二甲双胍 / 血钾 / 出血），二元组召回表现稳定；
 *  - 无词典、无网络、毫秒级构建索引，便于离线演示与本地复现；
 *  - 与 BM25 配合时，二元组天然比单字更少噪声。
 */

/** 停用词（对检索无区分度的高频词） */
const STOPWORDS = new Set([
  '的', '了', '是', '在', '有', '和', '与', '及', '或', '也', '就', '都', '而', '被', '把',
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '这个', '那个', '什么', '怎么',
  '吗', '呢', '吧', '啊', '呀', '哦', '请问', '一下', '可以', '需要', '应该', '是否', '是不', '不是',
  'the', 'a', 'an', 'of', 'to', 'and', 'or', 'is', 'are', 'for', 'in', 'on', 'with',
]);

const CJK = /[\u4e00-\u9fa5]/;
const ALNUM = /[a-z0-9]/;

/** 全角转半角 + 统一大小写 + 去掉常见标点噪声 */
export function normalize(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code === 0x3000) out += ' ';
    else if (code > 0xff00 && code < 0xff5f) out += String.fromCharCode(code - 0xfee0);
    else out += ch;
  }
  return out.toLowerCase();
}

/**
 * 分词：返回去重前的 token 列表（保留词频，BM25 需要）
 * - 中文：连续汉字串内生成相邻二元组（单字串保留单字）
 * - 英文/数字：按连续字母数字切词
 */
export function tokenize(input: string): string[] {
  const text = normalize(input);
  const tokens: string[] = [];
  let hanBuffer = '';
  let alnumBuffer = '';

  const flushHan = () => {
    if (!hanBuffer) return;
    if (hanBuffer.length === 1) {
      if (!STOPWORDS.has(hanBuffer)) tokens.push(hanBuffer);
    } else {
      for (let i = 0; i < hanBuffer.length - 1; i++) {
        const bi = hanBuffer.slice(i, i + 2);
        if (!STOPWORDS.has(bi)) tokens.push(bi);
      }
    }
    hanBuffer = '';
  };
  const flushAlnum = () => {
    if (!alnumBuffer) return;
    if (!STOPWORDS.has(alnumBuffer) && alnumBuffer.length > 0) tokens.push(alnumBuffer);
    alnumBuffer = '';
  };

  for (const ch of text) {
    if (CJK.test(ch)) {
      flushAlnum();
      hanBuffer += ch;
    } else if (ALNUM.test(ch) || ch === '.' || ch === '-') {
      // 保留药名中的点与连字符（如 vb12、l-t4），但避免把标点当独立词
      if (ch === '.' || ch === '-') {
        if (alnumBuffer.length > 0) alnumBuffer += ch;
      } else {
        flushHan();
        alnumBuffer += ch;
      }
    } else {
      flushHan();
      flushAlnum();
    }
  }
  flushHan();
  flushAlnum();
  return tokens.filter((t) => t.length > 0);
}

/** 词频表 */
export function termFreq(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
  return tf;
}

/** 截断长文本，保留语义完整的片段 */
export function clip(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}
