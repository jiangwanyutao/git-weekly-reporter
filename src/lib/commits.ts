import { CommitLog } from '@/types';

// 送进模型的上限，防止超长 prompt 触发模型退化（无限生成的主因之一）
const MAX_GROUPS_PER_PROJECT = 30;
const MAX_ITEMS_PER_GROUP = 50;
const MAX_TOTAL_ITEMS = 260;

// 提交少于这个数的模块不单独成条，并进「其他优化与修复」
const MIN_COMMITS_FOR_OWN_ITEM = 3;

// 这里只报事实（体量够独立成条的模块有几个），不规定该写几条。
// 颗粒度由提示词模板决定，否则切换模板时两边的指令会互相打架。
function standaloneCount(groups: CommitGroup[]): number {
  return groups.filter((g) => g.commitCount >= MIN_COMMITS_FOR_OWN_ITEM).length;
}

// 整条丢弃：这些提交对周报读者没有任何信息量
const NOISE_COMMIT = [
  /^merge\b/i,
  /^revert\s+"?revert/i,
  /^(chore\s*[:(])?\s*(bump|release|version)\b/i,
  /^v?\d+\.\d+\.\d+\s*$/,
  /^(wip|tmp|temp|debug|临时提交|测试提交)\b/i,
  /^(chore|style)\s*(\([^)]*\))?\s*[:：]\s*(format|formatting|lint|prettier|eslint|格式化|代码格式)/i,
  /^\s*(update|更新|修改|优化|提交|保存)\s*$/i,
  /^\.+$/,
];

// 工单号形态：AG-77 / BD-01a / AG-86-98（区间） / AG-57/58/60（同前缀简写）
const TICKET = String.raw`[A-Z]{2,5}-\d+[a-z]?(?:-\d+[a-z]?)*`;
const TICKET_TAIL = String.raw`(?:[A-Z]{2,5}-)?\d+[a-z]?(?:-\d+[a-z]?)*`;
const TICKET_LIST = `${TICKET}(?:\\s*[/、,，]\\s*${TICKET_TAIL})*`;
// 整组括号：(AG-69 / AG-86-98)、（MG-05 A+B）、（AG-59 全流程）
// 只吃行内空白，绝不能碰换行——否则会把下一行整条粘上来，毁掉整篇周报的结构
const TICKET_PAREN = new RegExp(
  `[（(][ \\t]*${TICKET_LIST}(?:[ \\t][^)）\\n]{0,12})?[ \\t]*[)）]`,
  'g'
);
const TICKET_BARE = new RegExp(`\\b${TICKET_LIST}\\b`, 'g');
// 工单号摘掉后剩下的空括号 / 只剩分隔符的括号
const HOLLOW_PAREN = /[（(][ \t/、,，:：+-]*[)）]/g;

// 从提交信息里剥掉「人类读周报时看不懂」的技术标记
const STRIP_RULES: [RegExp, string][] = [
  // conventional 前缀 feat: / fix(scope):
  [/^\s*(feat|fix|chore|refactor|docs|style|perf|test|build|ci|revert)(\([^)]*\))?\s*[:：]\s*/i, ''],
  // 括号里的工单号
  [TICKET_PAREN, ' '],
  // 裸工单号
  [TICKET_BARE, ''],
  [HOLLOW_PAREN, ''],
  // issue / PR 号
  [/\s*[（(]?#\d+[)）]?/g, ''],
  // commit hash
  [/\b[0-9a-f]{7,40}\b/g, ''],
  // 版本号
  [/\bv?\d+\.\d+\.\d+(-[\w.]+)?\b/g, ''],
  // git trailer
  [/\b(Co-authored-by|Signed-off-by|Reviewed-by)\s*:.*/gi, ''],
  // 开头的 [模块] 标记（已提取为分组键，正文不再需要）
  [/^\s*[[【]([^\]】]{1,20})[\]】]\s*/, ''],
];

// 清洗后只剩标点，视为没内容
const EMPTY_AFTER_CLEAN = /^[\s\-—–_/、,，.。:：|]*$/;

export function isNoiseCommit(message: string): boolean {
  const m = message.trim();
  if (!m) return true;
  return NOISE_COMMIT.some((re) => re.test(m));
}

export function cleanMessage(raw: string): string {
  let text = raw.trim();
  for (const [re, to] of STRIP_RULES) text = text.replace(re, to);
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-—–:：]+|[\s\-—–:：]+$/g, '')
    .trim();
}

// 模块名本身若是工单号（如 feat(PD-01): 这种写法），只留前缀字母，
// 否则工单号会顺着模块名漏进 prompt。
function normalizeModule(name: string): string {
  const asTicket = name.match(/^([A-Z]{2,5})-\d+/i);
  return (asTicket ? asTicket[1] : name).trim() || '其他';
}

// 提取模块键：conventional scope > 工单前缀字母 > 开头的 [模块] > 其他
export function extractModule(raw: string): string {
  const scope = raw.match(
    /^\s*(?:feat|fix|chore|refactor|docs|style|perf|test|build|ci)\(([^)]+)\)\s*[:：]/i
  );
  // 只取首段，让 agent 与 agent/fe 归到同一个模块
  if (scope) return normalizeModule(scope[1].split('/')[0].trim());

  const ticket = raw.match(/\b([A-Z]{2,5})-\d+/);
  if (ticket) return ticket[1];

  const bracket = raw.match(/^\s*[[【]([^\]】]{1,20})[\]】]/);
  if (bracket) return normalizeModule(bracket[1].trim());

  return '其他';
}

export interface CommitGroup {
  project: string;
  module: string;
  items: string[];      // 清洗并去重后的提交描述
  commitCount: number;  // 归并进本组的原始提交数
  omitted: number;      // 因超出上限未列出的条数（仍会在 prompt 里注明数量）
}

export interface AggregateResult {
  groups: CommitGroup[];
  totalInput: number;   // 传入的提交总数
  droppedNoise: number; // 被当作噪音丢弃的条数
  deduped: number;      // 因内容重复而合并掉的条数
  truncated: number;    // 因超出上限而未列出的条数
}

export function aggregateCommits(logs: CommitLog[]): AggregateResult {
  const map = new Map<string, CommitGroup>();
  let droppedNoise = 0;
  let deduped = 0;

  for (const log of logs) {
    if (isNoiseCommit(log.message)) {
      droppedNoise++;
      continue;
    }
    const text = cleanMessage(log.message);
    if (!text || EMPTY_AFTER_CLEAN.test(text)) {
      droppedNoise++;
      continue;
    }

    const module = extractModule(log.message);
    // 大小写不敏感归组，避免 UI 与 ui 被拆成两组。
    const key = `${log.project} ${module.toLowerCase()}`;
    let group = map.get(key);
    if (!group) {
      group = { project: log.project, module, items: [], commitCount: 0, omitted: 0 };
      map.set(key, group);
    }
    group.commitCount++;
    // 同组内内容重复的提交只保留一条
    if (group.items.includes(text)) deduped++;
    else group.items.push(text);
  }

  // 提交次数多的组排前面，让模型优先看到主线工作
  const all = Array.from(map.values()).sort(
    (a, b) => b.commitCount - a.commitCount || a.module.localeCompare(b.module)
  );

  let truncated = 0;
  let budget = MAX_TOTAL_ITEMS;
  const byProject = new Map<string, CommitGroup[]>();
  for (const g of all) {
    const list = byProject.get(g.project) ?? [];
    // 组数超限或总条目预算耗尽，剩下的只计数不列出
    const room = Math.min(MAX_ITEMS_PER_GROUP, budget);
    if (list.length >= MAX_GROUPS_PER_PROJECT || room <= 0) {
      truncated += g.items.length;
      continue;
    }
    if (g.items.length > room) {
      g.omitted = g.items.length - room;
      truncated += g.omitted;
      g.items = g.items.slice(0, room);
    }
    budget -= g.items.length;
    list.push(g);
    byProject.set(g.project, list);
  }

  return {
    groups: Array.from(byProject.values()).flat(),
    totalInput: logs.length,
    droppedNoise,
    deduped,
    truncated,
  };
}

// 组装成模型可读的文本：已按项目 / 模块归好组，模型只需在此基础上提炼
export function formatForPrompt(result: AggregateResult): string {
  const byProject = new Map<string, CommitGroup[]>();
  for (const g of result.groups) {
    byProject.set(g.project, [...(byProject.get(g.project) ?? []), g]);
  }

  const blocks: string[] = [];
  for (const [project, groups] of byProject) {
    const lines = groups.map((g) => {
      const head = g.module === '其他' ? '- 零散改动' : `- 模块「${g.module}」`;
      const note = g.commitCount < MIN_COMMITS_FOR_OWN_ITEM
        ? `（${g.commitCount} 次提交，体量小）`
        : `（${g.commitCount} 次提交）`;
      const items = g.items.map((t) => `    · ${t}`).join('\n');
      const rest = g.omitted > 0 ? `\n    · （另有 ${g.omitted} 条同类改动未逐条列出）` : '';
      return `${head}${note}\n${items}${rest}`;
    });

    const commits = groups.reduce((n, g) => n + g.commitCount, 0);
    blocks.push(
      `## 项目 [${project}]（${commits} 次提交，${groups.length} 个模块方向，` +
      `其中 ${standaloneCount(groups)} 个体量够独立成条）\n` +
      lines.join('\n')
    );
  }
  return blocks.join('\n\n');
}

// 补「周报周期」抬头。日期由代码给，不让模型自己写，避免它编错。
// 模型若自作主张写了一行周期，先删掉再换成权威值，防止出现两行。
export function withReportHeader(markdown: string, start: string, end: string): string {
  const body = markdown.replace(/^\s*\**\s*周报周期\s*[:：].*$/gm, '').trimStart();
  if (!start && !end) return body;
  return `**周报周期：** ${start} - ${end}\n\n${body}`;
}

// 生成后再兜一层：清掉模型漏抄出来的工单号、思维链标签等纯噪音
export function sanitizeReport(markdown: string): string {
  return markdown
    .replace(TICKET_PAREN, '')
    .replace(TICKET_BARE, '')
    .replace(HOLLOW_PAREN, '')
    .replace(/<\/?think(?:ing)?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // 摘掉标记后中文之间会留下空档，合并掉（只处理行内空格，不动换行）
    .replace(/([一-龥　-〿，。、；：！？）】」])[ \t]+(?=[一-龥　-〿，。、；：！？（【「])/g, '$1')
    // 只折叠正文中的连续空格，行首缩进要留着，否则 markdown 嵌套列表会被压平
    .replace(/(\S)[ \t]{2,}/g, '$1 ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
