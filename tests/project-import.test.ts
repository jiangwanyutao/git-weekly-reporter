// 运行：pnpm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, planImport } from '../src/lib/project-import.ts';

test('取文件夹名：兼容 Windows / Unix 分隔符和结尾斜杠', () => {
  assert.equal(basename('D:\\fusion\\emr-electron'), 'emr-electron');
  assert.equal(basename('/Users/me/code/app/'), 'app');
});

test('扫描结果里已添加过的仓库被标出来，其余可导入', () => {
  const plan = planImport(['D:\\work\\a', 'D:\\work\\b', 'D:\\work\\c'], ['D:\\work\\b']);
  assert.deepEqual(plan, [
    { path: 'D:\\work\\a', name: 'a', added: false },
    { path: 'D:\\work\\b', name: 'b', added: true },
    { path: 'D:\\work\\c', name: 'c', added: false },
  ]);
});

test('判断已添加时忽略分隔符、结尾斜杠和大小写差异', () => {
  const plan = planImport(['D:\\Work\\App'], ['d:/work/app/']);
  assert.equal(plan[0].added, true);
});

test('没有扫到仓库时返回空列表', () => {
  assert.deepEqual(planImport([], ['D:\\x']), []);
});
