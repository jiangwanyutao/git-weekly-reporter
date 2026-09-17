// 运行：pnpm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROMPT_TEMPLATES,
  CUSTOM_TEMPLATE_ID,
  DEFAULT_TEMPLATE_ID,
  DEFAULT_PROMPT,
  isUserTemplateId,
  findAnyTemplate,
  validateTemplateName,
  hasCommitsVariable,
  addUserTemplate,
  updateUserTemplate,
  removeUserTemplate,
  selectTemplate,
  editPromptContent,
  resolvePromptTemplate,
} from '../src/store/prompt-templates.ts';

const builtin = PROMPT_TEMPLATES[1];
const base = { promptTemplate: DEFAULT_PROMPT, promptTemplateId: DEFAULT_TEMPLATE_ID, customTemplates: [], theme: 'dark' };

test('新增模板：生成 user- 前缀 id，追加到列表并立即选中，其他设置不变', () => {
  const next = addUserTemplate(base, { name: ' 我的周报 ', description: '给老板看', content: '写周报 {{commits}}' });
  assert.equal(next.customTemplates.length, 1);
  const tpl = next.customTemplates[0];
  assert.ok(isUserTemplateId(tpl.id));
  assert.equal(tpl.name, '我的周报');
  assert.equal(next.promptTemplateId, tpl.id);
  assert.equal(next.promptTemplate, '写周报 {{commits}}');
  assert.equal(next.theme, 'dark');
  assert.equal(base.customTemplates.length, 0, '不能修改原对象');
});

test('名称校验：必填、不能与内置或自建模板重名，重命名时忽略自身', () => {
  const s = addUserTemplate(base, { name: '我的周报', description: '', content: 'x {{commits}}' });
  const id = s.customTemplates[0].id;
  assert.match(validateTemplateName('  ', s.customTemplates) ?? '', /名称/);
  assert.match(validateTemplateName(builtin.name, s.customTemplates) ?? '', /同名/);
  assert.match(validateTemplateName(' 我的周报', s.customTemplates) ?? '', /同名/);
  assert.equal(validateTemplateName('我的周报', s.customTemplates, id), null);
  assert.equal(validateTemplateName('另一个', s.customTemplates), null);
});

test('内容缺少 {{commits}} 时能识别出来', () => {
  assert.equal(hasCommitsVariable('写周报 {{commits}}'), true);
  assert.equal(hasCommitsVariable('写周报'), false);
});

test('查找模板：内置和自建都能按 id 找到', () => {
  const s = addUserTemplate(base, { name: 'A', description: '', content: 'a' });
  assert.equal(findAnyTemplate(builtin.id, s.customTemplates)?.name, builtin.name);
  assert.equal(findAnyTemplate(s.customTemplates[0].id, s.customTemplates)?.name, 'A');
  assert.equal(findAnyTemplate('user-missing', s.customTemplates), undefined);
});

test('选择模板：内置和自建都会把内容同步到当前提示词', () => {
  const s = addUserTemplate(base, { name: 'A', description: '', content: 'aaa' });
  const onBuiltin = selectTemplate(s, builtin.id);
  assert.equal(onBuiltin.promptTemplateId, builtin.id);
  assert.equal(onBuiltin.promptTemplate, builtin.content);
  const back = selectTemplate(onBuiltin, s.customTemplates[0].id);
  assert.equal(back.promptTemplate, 'aaa');
});

test('编辑内容：选中自建模板时改的是这个模板本身，不变成「自定义」', () => {
  const s = addUserTemplate(base, { name: 'A', description: '', content: 'old' });
  const id = s.customTemplates[0].id;
  const next = editPromptContent(s, 'new {{commits}}');
  assert.equal(next.promptTemplateId, id);
  assert.equal(next.promptTemplate, 'new {{commits}}');
  assert.equal(next.customTemplates[0].content, 'new {{commits}}');
});

test('编辑内容：选中内置模板时标记为「自定义」，内置模板不被修改', () => {
  const next = editPromptContent(selectTemplate(base, builtin.id), 'changed');
  assert.equal(next.promptTemplateId, CUSTOM_TEMPLATE_ID);
  assert.equal(next.promptTemplate, 'changed');
  assert.notEqual(PROMPT_TEMPLATES[1].content, 'changed');
});

test('重命名自建模板：名称和说明更新；改的是当前选中模板时内容也同步', () => {
  const s = addUserTemplate(base, { name: 'A', description: 'd', content: 'c1' });
  const id = s.customTemplates[0].id;
  const next = updateUserTemplate(s, id, { name: 'B', description: 'd2', content: 'c2' });
  assert.deepEqual(
    { name: next.customTemplates[0].name, description: next.customTemplates[0].description },
    { name: 'B', description: 'd2' }
  );
  assert.equal(next.promptTemplate, 'c2');
});

test('删除未选中的自建模板：只从列表移除，当前提示词不变', () => {
  const s1 = addUserTemplate(base, { name: 'A', description: '', content: 'a' });
  const idA = s1.customTemplates[0].id;
  const s2 = selectTemplate(s1, builtin.id);
  const next = removeUserTemplate(s2, idA);
  assert.equal(next.customTemplates.length, 0);
  assert.equal(next.promptTemplateId, builtin.id);
});

test('删除正在使用的自建模板：回到默认模板', () => {
  const s = addUserTemplate(base, { name: 'A', description: '', content: 'a' });
  const next = removeUserTemplate(s, s.customTemplates[0].id);
  assert.equal(next.promptTemplateId, DEFAULT_TEMPLATE_ID);
  assert.equal(next.promptTemplate, DEFAULT_PROMPT);
});

test('升级：选中自建模板的用户，重启后仍使用该模板内容', () => {
  const s = addUserTemplate(base, { name: 'A', description: '', content: 'mine {{commits}}' });
  const restored = resolvePromptTemplate({ ...s, promptTemplate: 'stale' });
  assert.equal(restored.promptTemplateId, s.promptTemplateId);
  assert.equal(restored.promptTemplate, 'mine {{commits}}');
});

test('升级：自建模板 id 找不到时回到默认模板', () => {
  const restored = resolvePromptTemplate({ promptTemplate: 'x', promptTemplateId: 'user-gone', customTemplates: [] });
  assert.equal(restored.promptTemplateId, DEFAULT_TEMPLATE_ID);
  assert.equal(restored.promptTemplate, DEFAULT_PROMPT);
});

test('升级：老用户的「自定义」提示词原样保留', () => {
  const restored = resolvePromptTemplate({ promptTemplate: '我自己写的', promptTemplateId: CUSTOM_TEMPLATE_ID });
  assert.equal(restored.promptTemplateId, CUSTOM_TEMPLATE_ID);
  assert.equal(restored.promptTemplate, '我自己写的');
});

test('升级：内置模板跟随代码更新', () => {
  const restored = resolvePromptTemplate({ promptTemplate: '旧内容', promptTemplateId: builtin.id });
  assert.equal(restored.promptTemplate, builtin.content);
});
