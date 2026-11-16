import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeWorkSections } from '../src/lib/report-format.ts';

test('单条记录缺少空栏目时补齐标题并保留正文', () => {
  const output = completeWorkSections('【aiplatform】本周\n\n二、本周完成\n\n1. 知识库优化');
  assert.equal(output, '【aiplatform】本周\n\n一、上周计划兑现\n\n二、本周完成\n\n1. 知识库优化\n\n三、卡住的事\n\n五、下周计划\n\n工时：');
});

test('多项目分别补齐，不重复或覆盖已有栏目', () => {
  const output = completeWorkSections('【项目甲】本周\n\n一、上周计划兑现\n已完成\n\n二、本周完成\n1. 甲\n\n【项目乙】本周\n\n二、本周完成\n1. 乙');
  assert.equal((output.match(/一、上周计划兑现/g) || []).length, 2);
  assert.equal((output.match(/工时：/g) || []).length, 2);
  assert.match(output, /一、上周计划兑现\n已完成/);
});
