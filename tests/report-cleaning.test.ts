import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findJargon, reportShape, sanitizeReport } from '../src/lib/commits.ts';

test('自定义格式也能清除工单号并检测剩余技术词', () => {
  const original = '# 进度\n\n摘要：\n1. 修复问题 AG-77，调整 user_name 的显示。\n\n待办：\n- 人工填写';
  const cleaned = sanitizeReport(original);
  assert.doesNotMatch(cleaned, /AG-77/);
  assert.deepEqual(findJargon(cleaned), ['user_name']);
  assert.equal(reportShape(cleaned), reportShape(original));
});

test('润色必须保持栏目顺序、编号、表格和空行', () => {
  const original = '# 周报\n\n摘要：\n1. 修复 user_name\n\n待办：\n| 项目 | 状态 |\n| --- | --- |\n| 甲 | 完成 |';
  assert.equal(reportShape(original), reportShape(original.replace('修复 user_name', '修复名称显示')));
  assert.notEqual(reportShape(original), reportShape(original.replace('待办：', '计划：')));
  assert.notEqual(reportShape(original), reportShape(original.replace('1. 修复', '2. 修复')));
  assert.notEqual(reportShape(original), reportShape(original.replace('| 甲 | 完成 |', '| 甲 |')));
  assert.notEqual(reportShape(original), reportShape(original.replace('\n\n待办：', '\n待办：')));
});
