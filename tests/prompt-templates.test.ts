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

test('自建周报模板保存并恢复后，保留缺失栏目时省略的指令', () => {
  const content = '【项目名称】\n二、本周完成\n其他栏目没有信息时省略。\n{{commits}}';
  const saved = addUserTemplate(base, { name: '周报格式', description: '', content });
  const restored = resolvePromptTemplate(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.promptTemplateId, saved.promptTemplateId);
  assert.equal(restored.promptTemplate, content);
});

test('本周完成模板保留功能归并规则，并要求缺失栏目留空', () => {
  const template = PROMPT_TEMPLATES.find((t) => t.id === 'completed-work')!;
  assert.ok(template);
  assert.match(template.content, /二、本周完成/);
  assert.match(template.content, /标题下方留空/);
  for (const title of ['一、上周计划兑现', '二、本周完成', '三、卡住的事', '五、下周计划', '工时：']) assert.ok(template.content.includes(title));
  assert.match(template.content, /同一个功能哪怕跨了好几个模块/);
  assert.doesNotMatch(template.content, /订单导出能力上线/);
  assert.match(template.content, /\{\{commits\}\}/);
});

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

test('生成时已选中的本周完成模板使用最新内容，不沿用旧的省略栏目指令', () => {
  const restored = resolvePromptTemplate({ promptTemplateId: 'completed-work', promptTemplate: '旧版：连标题一起省略' });
  assert.match(restored.promptTemplate, /标题下方留空/);
  assert.doesNotMatch(restored.promptTemplate, /连标题一起省略/);
  assert.match(restored.promptTemplate, /一、上周计划兑现/);
  assert.match(restored.promptTemplate, /工时：/);
});

test('逐个功能点写：有专用内置模板，默认模板保持不变', () => {
  const few = PROMPT_TEMPLATES.find((t) => t.id === 'few-commits');
  assert.ok(few, '缺少 few-commits 模板');
  assert.match(few.name, /逐个功能点/);
  assert.ok(hasCommitsVariable(few.content));
  assert.equal(DEFAULT_TEMPLATE_ID, 'feature-merge');
  assert.equal(PROMPT_TEMPLATES[0].id, 'feature-merge');
});

test('逐个功能点写：忽略「体量小」标注，也没有压缩条目的规则', () => {
  const few = PROMPT_TEMPLATES.find((t) => t.id === 'few-commits')!;
  assert.match(few.content, /「体量小」标注\*\*本模板一律忽略/);
  assert.doesNotMatch(few.content, /一律收进最后一条/);
});

// 预处理在项目标题里报「M 条不同改动」；按模块数定条目、把一个模块当成一件事的旧说法
// 会让没写模块的一整周提交被写成一条
test('细颗粒度的内置模板按不同改动条数定条目数，不再按模块压缩', () => {
  for (const id of ['feature-merge', 'detailed', 'few-commits']) {
    const t = PROMPT_TEMPLATES.find((x) => x.id === id)!;
    assert.match(t.content, /M 条不同改动/, id);
    assert.match(t.content, /未标模块的改动/, id);
    assert.doesNotMatch(t.content, /体量够独立成条|同一模块下的多条记录属于同一件事|依然只写一条|按它标注的条目数/, id);
  }
});

test('逐个功能点写：模板可以被选中，重启后仍保持选中并跟随代码更新', () => {
  const s = selectTemplate(base, 'few-commits');
  assert.equal(s.promptTemplateId, 'few-commits');
  const restored = resolvePromptTemplate({ ...s, promptTemplate: '旧内容' });
  assert.equal(restored.promptTemplateId, 'few-commits');
  assert.equal(restored.promptTemplate, PROMPT_TEMPLATES.find((t) => t.id === 'few-commits')!.content);
});
