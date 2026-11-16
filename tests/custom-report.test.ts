import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWeeklyReport } from '../src/lib/glm.ts';
import { addUserTemplate, resolvePromptTemplate } from '../src/store/prompt-templates.ts';

test('恢复的自定义模板和提交记录传给模型，流式结果保持原样', async () => {
  const template = '【项目名称】\n二、本周完成\n没有信息的其他栏目不输出。\n{{commits}}';
  const saved = addUserTemplate({ promptTemplate: '' }, { name: '周报', description: '', content: template });
  const restored = resolvePromptTemplate(JSON.parse(JSON.stringify(saved)));
  const settings = { ...restored, activeProviderId: 'test', providers: [{ id: 'test', name: 'test', protocol: 'openai', apiKey: 'test', model: 'test', baseUrl: 'https://example.test' }] };
  const expected = '【项目甲】\n\n二、本周完成\n\n1. 完成查询功能';
  const originalFetch = globalThis.fetch;
  let prompt = '';
  globalThis.fetch = async (_url, init) => {
    prompt = JSON.parse(String(init?.body)).messages[0].content;
    const chunk = JSON.stringify({ choices: [{ delta: { content: expected }, finish_reason: 'stop' }] });
    return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`);
  };
  try {
    const result = await generateWeeklyReport(settings, restored.promptTemplate, '项目甲：修复 $& 查询', '');
    assert.ok(prompt.includes('没有信息的其他栏目不输出。'));
    assert.ok(prompt.includes('项目甲：修复 $& 查询'));
    assert.equal(result, expected);
    assert.doesNotMatch(result, /上周计划兑现|卡住的事|下周计划|工时/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
