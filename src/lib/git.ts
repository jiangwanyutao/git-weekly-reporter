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
import { CommitLog } from '@/types';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function fetchGitLogs(projectPath: string, author: string, since?: string, until?: string, projectNameOverride?: string): Promise<CommitLog[]> {
  // 如果不在 Tauri 环境下，返回 Mock 数据
  if (!isTauri) {
    console.log('Running in Web mode, returning mock logs.');
    return [
      { hash: 'a1b2c3d', author: 'DemoUser', date: dayjs().subtract(1, 'hour').format('YYYY-MM-DD HH:mm:ss'), message: 'feat: 完成用户登录功能', project: projectNameOverride || 'git-weekly-reporter', branch: 'main' },
      { hash: 'e5f6g7h', author: 'DemoUser', date: dayjs().subtract(1, 'day').format('YYYY-MM-DD HH:mm:ss'), message: 'fix: 修复样式兼容性问题', project: projectNameOverride || 'git-weekly-reporter', branch: 'develop' },
      { hash: 'i8j9k0l', author: 'DemoUser', date: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'), message: 'docs: 更新 README 文档', project: projectNameOverride || 'git-weekly-reporter', branch: 'feature/docs' },
    ];
  }

  // 默认本周五到上周五
  const end = until || dayjs().day(5).hour(18).format('YYYY-MM-DD HH:mm:ss');
  const start = since || dayjs().day(5).subtract(1, 'week').hour(18).format('YYYY-MM-DD HH:mm:ss');

  try {
    // 1. 获取当前分支名
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

    const args = [
      '-C', projectPath,
      'log',
      `--since=${start}`,
      `--until=${end}`,
      '--pretty=format:%h|%an|%ad|%s',
      '--date=format:%Y-%m-%d %H:%M:%S',
      '-n', '1000' // 限制最大获取条数，防止卡死
    ];

    if (author) {
      // --author 必须在 log 命令之后
      // args 现在的结构是: ['-C', path, 'log', ...others]
      // 我们直接把它 push 进去，或者在构建数组时就放进去
      // 这里为了简单，我们重新构建 args
      args.splice(3, 0, `--author=${author}`);
    }

    const command = Command.create('git', args);
    const output = await command.execute();

    if (output.code !== 0) {
      console.warn(`Git warning for ${projectPath}:`, output.stderr);
      return [];
    }

    const projectName = projectNameOverride || projectPath.split(/[\\/]/).pop() || 'Unknown';

    const logs: CommitLog[] = [];
    for (const line of output.stdout.split('\n')) {
      if (!line.trim()) continue;
      const match = line.match(/^([^|]*)\|([^|]*)\|([^|]*)\|(.*)$/);
      if (!match) continue;

      const [, hash, authorName, date, message] = match;
      logs.push({
        hash,
        author: authorName,
        date,
        message,
        project: projectName,
        branch: currentBranch
      });
    }

    return logs;

  } catch (error) {
    console.error(`Failed to fetch logs for ${projectPath}:`, error);
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
    const command = Command.create('git', ['-C', projectPath, 'shortlog', '-s', '-n', 'HEAD']);
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
