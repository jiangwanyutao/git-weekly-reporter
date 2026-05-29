/*
 * @Author: 江晚正愁余 1015134040@qq.com
 * @Date: 2026-01-29 15:31:51
 * @LastEditors: 江晚正愁余 1015134040@qq.com
 * @LastEditTime: 2026-01-30 10:02:51
 * @FilePath: \年底总结项目\git-weekly-reporter\src\lib\git.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Command } from '@tauri-apps/plugin-shell';
import dayjs from 'dayjs';
import { CommitLog, Project } from '@/types';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// 把 git ref（refs/heads/xxx、refs/remotes/origin/xxx、HEAD）规整成可读的分支名
function normalizeBranchName(ref: string, fallback: string): string {
  const cleaned = ref.trim();
  if (!cleaned || cleaned === 'HEAD') return fallback;
  return cleaned
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\//, '')
    .replace(/^remotes\//, '');
}

export async function fetchGitLogs(
  project: Project,
  globalAuthor: string,
  since?: string,
  until?: string
): Promise<CommitLog[]> {
  const projectName = project.alias || project.name;

  // 如果不在 Tauri 环境下，返回 Mock 数据
  if (!isTauri) {
    console.log('Running in Web mode, returning mock logs.');
    return [
      { hash: 'a1b2c3d', author: 'DemoUser', date: dayjs().subtract(1, 'hour').format('YYYY-MM-DD HH:mm:ss'), message: 'feat: 完成用户登录功能', project: projectName, branch: 'main' },
      { hash: 'e5f6g7h', author: 'DemoUser', date: dayjs().subtract(1, 'day').format('YYYY-MM-DD HH:mm:ss'), message: 'fix: 修复样式兼容性问题', project: projectName, branch: 'develop' },
      { hash: 'i8j9k0l', author: 'DemoUser', date: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'), message: 'docs: 更新 README 文档', project: projectName, branch: 'feature/docs' },
    ];
  }

  const projectPath = project.path;

  // 默认本周五到上周五
  const end = until || dayjs().day(5).hour(18).format('YYYY-MM-DD HH:mm:ss');
  const start = since || dayjs().day(5).subtract(1, 'week').hour(18).format('YYYY-MM-DD HH:mm:ss');

  // 解析每项目配置（缺省按 'all' / 'inherit'）
  const branchMode = project.branchMode ?? 'all';
  const authorMode = project.authorMode ?? 'inherit';
  const resolvedAuthor =
    authorMode === 'all' ? '' :
    authorMode === 'specific' ? (project.author || '') :
    globalAuthor;

  try {
    // 当前分支名，用于显示兜底
    let currentBranch = 'HEAD';
    try {
        const branchCmd = Command.create('git', ['-C', projectPath, 'rev-parse', '--abbrev-ref', 'HEAD']);
        const branchOut = await branchCmd.execute();
        if (branchOut.code === 0) {
            currentBranch = branchOut.stdout.trim();
        }
    } catch (e) {
        console.warn('Failed to get branch name', e);
    }

    // 组装 git log 参数。统一带 ref，使 %S（reached-by ref）在各模式下都能还原真实分支
    const args = ['-C', projectPath, 'log'];
    if (branchMode === 'all') {
      args.push('--all');
    } else if (branchMode === 'specific' && project.branch) {
      args.push(project.branch);
    } else {
      // current：显式传当前分支名（等价 HEAD），让 %S 能取到分支
      args.push(currentBranch === 'HEAD' ? 'HEAD' : currentBranch);
    }

    args.push(
      `--since=${start}`,
      `--until=${end}`,
      '--pretty=format:%h|%an|%ad|%S|%s',
      '--date=format:%Y-%m-%d %H:%M:%S',
      '-n', '1000' // 限制最大获取条数，防止卡死
    );

    if (resolvedAuthor) {
      args.push(`--author=${resolvedAuthor}`);
    }

    const command = Command.create('git', args);
    const output = await command.execute();

    if (output.code !== 0) {
      console.warn(`Git warning for ${projectPath}:`, output.stderr);
      return [];
    }

    const logs: CommitLog[] = [];
    for (const line of output.stdout.split('\n')) {
      if (!line.trim()) continue;
      // 字段：hash|作者|日期|reached-by-ref|消息（消息可能含 | 故放最后）
      const match = line.match(/^([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)$/);
      if (!match) continue;

      const [, hash, authorName, date, refName, message] = match;
      logs.push({
        hash,
        author: authorName,
        date,
        message,
        project: projectName,
        branch: normalizeBranchName(refName, currentBranch),
      });
    }

    return logs;

  } catch (error) {
    console.error(`Failed to fetch logs for ${projectPath}:`, error);
    return [];
  }
}

// 列出项目的所有分支（本地 + 远程），供分支选择下拉使用
export async function getProjectBranches(projectPath: string): Promise<string[]> {
  if (!isTauri) return ['main', 'develop', 'feature/docs'];

  try {
    const command = Command.create('git', [
      '-C', projectPath,
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads', 'refs/remotes',
    ]);
    const output = await command.execute();
    if (output.code !== 0) return [];

    const branches = output.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((b) => !b.endsWith('/HEAD')); // 过滤 origin/HEAD 之类的符号引用

    return Array.from(new Set(branches));
  } catch (e) {
    console.warn('Failed to list branches', e);
    return [];
  }
}

export async function getProjectContext(projectPath: string): Promise<string> {
  if (!isTauri) return `Project: ${projectPath}\nMock Context: React + TypeScript Project\n---\n`;

  let context = `Project: ${projectPath.split(/[\\/]/).pop()}\n`;

  try {
    // 1. Try to read package.json
    const pkgCmd = Command.create('git', ['-C', projectPath, 'show', 'HEAD:package.json']);
    const pkgOut = await pkgCmd.execute();
    if (pkgOut.code === 0) {
      try {
        const pkg = JSON.parse(pkgOut.stdout);
        context += `Type: Node.js/Frontend Project\n`;
        context += `Name: ${pkg.name || 'Unnamed'}\n`;
        context += `Description: ${pkg.description || 'No description'}\n`;
        if (pkg.dependencies) {
           const deps = Object.keys(pkg.dependencies).slice(0, 15).join(', ');
           context += `Key Dependencies: ${deps}\n`;
        }
      } catch (e) {
        // Not a valid JSON
      }
    } else {
        // Try Cargo.toml for Rust
        const cargoCmd = Command.create('git', ['-C', projectPath, 'show', 'HEAD:Cargo.toml']);
        const cargoOut = await cargoCmd.execute();
        if (cargoOut.code === 0) {
             context += `Type: Rust Project\n`;
             // Simple parsing or just take first few lines
             const lines = cargoOut.stdout.split('\n').slice(0, 5).join(' ');
             context += `Cargo Info: ${lines}\n`;
        }
    }

    // 2. Try to read README.md
    const readmeCmd = Command.create('git', ['-C', projectPath, 'show', 'HEAD:README.md']);
    const readmeOut = await readmeCmd.execute();
    if (readmeOut.code === 0) {
      // Remove code blocks and excessive newlines to save tokens
      const summary = readmeOut.stdout
        .replace(/```[\s\S]*?```/g, '') // Remove code blocks
        .slice(0, 500)
        .replace(/\n+/g, ' ')
        .trim();
      context += `Readme Abstract: ${summary}...\n`;
    }

  } catch (e) {
    console.warn("Failed to get project context", e);
  }

  return context + "\n---\n";
}

export async function getProjectAuthors(projectPath: string): Promise<string[]> {
  if (!isTauri) return ['DemoUser', 'AnotherUser'];

  try {
    const command = Command.create('git', ['-C', projectPath, 'shortlog', '-s', '-n', '--all']);
    const output = await command.execute();

    if (output.code !== 0) return [];

    return output.stdout.split('\n')
      .filter(line => line.trim())
      .map(line => {
        // Line format: "   10  Author Name"
        const match = line.match(/^\s*\d+\s+(.+)$/);
        return match ? match[1].trim() : '';
      })
      .filter(Boolean);
  } catch (e) {
    console.warn("Failed to get authors", e);
    return [];
  }
}
