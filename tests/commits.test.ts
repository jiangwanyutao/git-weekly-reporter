// 运行：pnpm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCommits, formatForPrompt } from '../src/lib/commits.ts';

// 没写模块的 conventional 提交（feat: xxx）全部落进同一组，这是最常见的写法
const unscoped = (n: number, project = 'A') =>
  Array.from({ length: n }, (_, i) => ({
    hash: `h${i}`,
    author: 'me',
    date: '2026-10-16',
    branch: 'master',
    project,
    message: `${i % 2 ? 'fix' : 'feat'}: 第 ${i} 项改动`,
  }));

test('一周 300 条不同改动全部送进模型，不会因为都落在同一组被截掉大半', () => {
  const r = aggregateCommits(unscoped(300));
  const text = formatForPrompt(r);
  assert.equal(r.truncated, 0);
  assert.equal(text.split('\n').filter((l) => l.startsWith('    · 第')).length, 300);
});

test('项目和模块标题报出不同改动的条数，不再报「体量够独立成条」的模块数', () => {
  const text = formatForPrompt(aggregateCommits([...unscoped(299, 'A'), ...unscoped(3, 'B')]));
  assert.match(text, /## 项目 \[A\]（299 次提交，299 条不同改动/);
  assert.match(text, /## 项目 \[B\]（3 次提交，3 条不同改动/);
  assert.doesNotMatch(text, /体量够独立成条/);
});
