import dayjs from 'dayjs';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings, Report } from '@/types';

const RICH_TEXT_LIMIT = 1800;
// Notion 单次请求最多 100 个 children，这里不再前端截断内容，
// 而是生成完整块后交由 Rust 端（create_notion_page）按每 100 个分批发送。
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const DEFAULT_NOTION_SYNC_MODE = 'append' as const;

type NotionSyncResult = {
  id: string;
  url?: string;
};

type NotionSyncMode = 'append' | 'subpage';
type NotionContentMode = 'markdown' | 'code';
type NotionCodeLanguage =
  | 'plain text'
  | 'abap'
  | 'arduino'
  | 'bash'
  | 'c'
  | 'c#'
  | 'c++'
  | 'clojure'
  | 'coffeescript'
  | 'css'
  | 'dart'
  | 'diff'
  | 'docker'
  | 'elixir'
  | 'elm'
  | 'erlang'
  | 'flow'
  | 'fortran'
  | 'f#'
  | 'gherkin'
  | 'glsl'
  | 'go'
  | 'graphql'
  | 'groovy'
  | 'haskell'
  | 'html'
  | 'java'
  | 'javascript'
  | 'json'
  | 'julia'
  | 'kotlin'
  | 'latex'
  | 'less'
  | 'lisp'
  | 'livescript'
  | 'lua'
  | 'makefile'
  | 'markdown'
  | 'markup'
  | 'matlab'
  | 'mermaid'
  | 'nix'
  | 'objective-c'
  | 'ocaml'
  | 'pascal'
  | 'perl'
  | 'php'
  | 'powershell'
  | 'prolog'
  | 'protobuf'
  | 'python'
  | 'r'
  | 'reason'
  | 'ruby'
  | 'rust'
  | 'sass'
  | 'scala'
  | 'scheme'
  | 'scss'
  | 'shell'
  | 'sql'
  | 'swift'
  | 'typescript'
  | 'vb.net'
  | 'verilog'
  | 'vhdl'
  | 'visual basic'
  | 'webassembly'
  | 'xml'
  | 'yaml'
  | 'java/c/c++/c#';

function createRichText(content: string) {
  const source = content || ' ';
  return splitByLength(source, RICH_TEXT_LIMIT).map((chunk) => ({
    type: 'text' as const,
    text: { content: chunk },
  }));
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .trim();
}

function mapCodeLanguage(langRaw: string): NotionCodeLanguage {
  const lang = langRaw.trim().toLowerCase();
  if (!lang) return 'plain text';

  const aliasMap: Record<string, NotionCodeLanguage> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    sh: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    yml: 'yaml',
    md: 'markdown',
    text: 'plain text',
    txt: 'plain text',
    cs: 'c#',
    cpp: 'c++',
    cxx: 'c++',
  };

  return aliasMap[lang] ?? (lang as NotionCodeLanguage);
}

function buildCodeBlocks(raw: string, language: NotionCodeLanguage) {
  const text = raw.trim();
  if (!text) {
    return [
      {
        object: 'block',
        type: 'code',
        code: {
          language,
          rich_text: createRichText('（空内容）'),
        },
      },
    ];
  }

  return splitByLength(text, RICH_TEXT_LIMIT).map((chunk) => ({
    object: 'block',
    type: 'code',
    code: {
      language,
      rich_text: createRichText(chunk),
    },
  }));
}

function parseMarkdownToBlocks(markdown: string): Array<Record<string, unknown>> {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Array<Record<string, unknown>> = [];

  let paragraphLines: string[] = [];
  let inCodeBlock = false;
  let codeLanguage: NotionCodeLanguage = 'plain text';
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = stripInlineMarkdown(paragraphLines.join('\n'));
    paragraphLines = [];
    if (!text) return;
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: createRichText(text) },
    });
  };

  const flushCode = () => {
    const text = codeLines.join('\n');
    codeLines = [];
    for (const block of buildCodeBlocks(text, codeLanguage)) {
      blocks.push(block);
    }
  };

  for (const rawLine of lines) {
    const line = rawLine ?? '';

    if (inCodeBlock) {
      const codeEnd = line.trimStart().startsWith('```');
      if (codeEnd) {
        flushCode();
        inCodeBlock = false;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const codeStart = line.match(/^\s*```([\w#+.-]*)\s*$/);
    if (codeStart) {
      flushParagraph();
      inCodeBlock = true;
      codeLanguage = mapCodeLanguage(codeStart[1] || 'plain text');
      codeLines = [];
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const text = stripInlineMarkdown(headingMatch[2]).slice(0, 200);
      const type = level === 1 ? 'heading_1' : level === 2 ? 'heading_2' : 'heading_3';
      blocks.push({
        object: 'block',
        type,
        [type]: { rich_text: createRichText(text) },
      });
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      const text = stripInlineMarkdown(quoteMatch[1]);
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: createRichText(text || ' ') },
      });
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      const text = stripInlineMarkdown(bulletMatch[1]);
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: createRichText(text || ' ') },
      });
      continue;
    }

    const numberMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (numberMatch) {
      flushParagraph();
      const text = stripInlineMarkdown(numberMatch[1]);
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: createRichText(text || ' ') },
      });
      continue;
    }

    paragraphLines.push(line);
  }

  if (inCodeBlock) {
    flushCode();
  }
  flushParagraph();

  if (blocks.length === 0) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: createRichText('（空内容）') },
    });
  }

  return blocks;
}

function normalizeNotionPageId(raw: string): string {
  const input = raw.trim();
  if (!input) {
    throw new Error('Notion 目标页面 ID 为空');
  }

  const uuidMatch = input.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (uuidMatch) {
    return uuidMatch[0].toLowerCase();
  }

  const compactMatch = input.match(/[0-9a-fA-F]{32}/);
  const compact = compactMatch ? compactMatch[0].toLowerCase() : input.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new Error('Notion 页面 ID 格式无效，请粘贴页面 URL 或 32 位 Page ID');
  }

  return compact.replace(
    /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/,
    '$1-$2-$3-$4-$5'
  );
}

function splitByLength(text: string, maxLength: number): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength));
  }
  return chunks;
}

function buildReportPayload(report: Report) {
  const title = `周报 ${report.dateRange.start} ~ ${report.dateRange.end}`;
  const metadataLines = [
    `生成时间: ${dayjs(report.createdAt).format('YYYY-MM-DD HH:mm:ss')}`,
    report.totalCommits !== undefined ? `提交总数: ${report.totalCommits}` : '',
    report.projects?.length ? `涉及项目: ${report.projects.join(', ')}` : '',
    report.branches?.length ? `涉及分支: ${report.branches.join(', ')}` : '',
  ].filter(Boolean);

  const content = `${metadataLines.join('\n')}\n\n${report.content}`.trim();

  return { title, content };
}

function buildAppendChildren(title: string, contentBlocks: Array<Record<string, unknown>>) {
  return [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [
          {
            type: 'text',
            text: { content: title.slice(0, 200) },
          },
        ],
      },
    },
    ...contentBlocks,
    {
      object: 'block',
      type: 'divider',
      divider: {},
    },
  ] as Array<Record<string, unknown>>;
}

export async function syncReportToNotion(
  report: Report,
  settings: AppSettings
): Promise<NotionSyncResult> {
  if (!isTauri) {
    throw new Error('Web 模式受 Notion CORS 限制，请使用桌面客户端同步');
  }

  const token = settings.notionApiKey.trim();
  if (!token) {
    throw new Error('Notion Integration Token 未配置');
  }

  const parentPageId = normalizeNotionPageId(settings.notionParentPageId);
  const { title, content } = buildReportPayload(report);
  const syncMode: NotionSyncMode = settings.notionSyncMode || DEFAULT_NOTION_SYNC_MODE;
  const contentMode: NotionContentMode = settings.notionContentMode || 'markdown';
  const contentBlocks = contentMode === 'code'
    ? buildCodeBlocks(content, 'markdown')
    : parseMarkdownToBlocks(content);
  const children = syncMode === 'subpage'
    ? contentBlocks
    : buildAppendChildren(title, contentBlocks);

  try {
    return await invoke<NotionSyncResult>('create_notion_page', {
      token,
      parentPageId,
      title: title.slice(0, 200),
      syncMode,
      children,
      proxyUrl: settings.notionProxyUrl?.trim() || null,
    });
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (message.toLowerCase().includes('failed to fetch')) {
      throw new Error('Notion 请求失败: 网络不可达，请检查网络/代理（部分网络环境无法直连 Notion）');
    }
    throw new Error(message || 'Notion 请求失败: 网络异常，请检查网络或代理设置');
  }
}
