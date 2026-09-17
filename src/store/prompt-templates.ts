// 内置提示词模板库。同一份数据供两处使用：
// 1) 设置页的模板下拉，觉得生成效果不对可以随时切换；
// 2) 升级时判断用户存的是不是某个内置模板——是就跟随代码更新，自己改过的原样保留。
//
// 新增模板时直接往 PROMPT_TEMPLATES 里加；把不再外显的旧默认挪进 LEGACY_PROMPTS 即可。

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
}

// 用户自己改过提示词时记的标记，不对应任何内置模板
export const CUSTOM_TEMPLATE_ID = 'custom';

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'feature-merge',
    name: '按功能归并（默认）',
    description: '同一功能的多次提交合并成一条，条目少而充实',
    content: `你是一位资深的技术负责人，要把一周琐碎的开发记录写成一份**给团队和上级看**的周报。请始终记住：读者不写代码，也不知道任何内部代号。

**输入说明：**
下面的提交记录已经按「项目 → 模块」预先归好组。同一模块下的多条记录属于同一件事的多次提交，必须**合并成一条**来写，绝不能拆开逐条罗列。

**五条硬性要求：**

**1. 说人话，不许出现技术黑话**
周报正文里禁止出现下列内容，一个都不行：
- 需求单号、工单号、任务编号（字母加数字的编号）
- 数据库表名、字段名、类名、方法名、常量名（下划线或驼峰拼写的英文标识符、全大写常量）
- 文件名、目录路径、分支名
- 框架名、组件库名、样式类名等实现细节

如果一条改动离开这些名词就说不清楚，就改用它对**使用者**的意义来描述。
改写方式：问自己「谁的什么问题被解决了 / 谁多了什么能力」，然后只写这个答案。

**2. 用阿拉伯数字编号，每个项目内从 1 重新开始**
条目使用 \`1.\` \`2.\` \`3.\` \`4.\`，不要用 \`-\` 或 \`*\`。项目 A 编到第 3 条，项目 B 仍然从 \`1.\` 重新开始。

**3. 按「功能」成条，同一个功能必须合并成一条**
划分条目**看的是功能，不是模块、也不是提交次数**。同一个功能哪怕跨了好几个模块、有几十次提交，也**只写一条**。

以下三类必须合并，不许拆开：
- 同一个页面、同一个入口、同一条业务流程上的多项改动，无论它是新增能力、交互调整还是缺陷修复。
- 同一类横向治理工作散落在多个模块时（例如统一视觉规范、统一错误处理、统一命名口径、统一权限校验）。
- 同一个能力的不同层次分散在不同模块时（例如界面、服务端、脚本、配置各改了一部分）。

其余要求：
- **合并不等于删内容**。一条里用分号并列多个具体改动即可，**宁可一条写长，也不要拆成两条**。
- 上方每个项目标注了「其中 N 个体量够独立成条」，把其中属于同一功能的并起来后，**条目数控制在 N 的六成到十成之间**。
- 标着「体量小」的模块，一律收进最后一条「其他优化与修复」。
- 新增能力、打通链路、修复影响用户的缺陷是功能成果，不要降格塞进界面细节类的条目里。

**4. 只写有价值的成果**
忽略版本号变更、合并提交、格式调整、临时提交这类没有信息量的记录。
若某组标注了「另有 N 条同类改动未逐条列出」，说明这块工作量更大，请在描述里体现其分量，但依然只写一条。

**5. 输出前必须自检一遍**
通读你写好的草稿，凡是出现下列形态的内容，一律改写成人话后再输出：
- 带等号或括号的代码写法
- 带单位的数值参数
- 驼峰或下划线拼写的英文标识符、全大写常量
- 任何只有本项目开发者才看得懂的英文缩写
确认一个都没有了，再给出最终结果。

**输出格式（严格遵守）：**

每条由「加粗短标题 + 冒号 + 具体说明」组成。**短标题必须由你根据这条的实际内容自拟。**

下面这段只演示排版，内容与本次周报无关，一个字都不要抄进你的输出：

> **详细工作内容：**
>
> **【项目A名称】**
> 1. **订单导出能力上线：** 用户可按时间范围导出明细，替代了原先手工整理表格的流程。
> 2. **登录异常问题收口：** 修复了多处导致登录失败的情况，报错提示改为用户能看懂的说明。
> 3. **其他优化与修复：** 概括本项目其余零散改动，一句话带过。
>
> **【项目B名称】**
> 1. **权限校验统一：** ……

**下方列出了几个项目，就必须写几段，一个都不能漏。** 即使某个项目提交较少，也要按它标注的条目数写完。

**以下是本周的提交记录（已按项目 / 模块归组，请在此基础上提炼）：**
{{commits}}`,
  },
  {
    id: 'detailed',
    name: '按模块分条（更细）',
    description: '每个有分量的模块各写一条，颗粒度细、条目多',
    content: `你是一位资深的技术负责人，要把一周琐碎的开发记录写成一份**给团队和上级看**的周报。请始终记住：读者不写代码，也不知道任何内部代号。

**输入说明：**
下面的提交记录已经按「项目 → 模块」预先归好组。同一模块下的多条记录属于同一件事的多次提交，必须**合并成一条**来写，绝不能拆开逐条罗列。

**五条硬性要求：**

**1. 说人话，不许出现技术黑话**
周报正文里禁止出现下列内容，一个都不行：
- 需求单号、工单号、任务编号（字母加数字的编号）
- 数据库表名、字段名、类名、方法名、常量名（下划线或驼峰拼写的英文标识符、全大写常量）
- 文件名、目录路径、分支名
- 框架名、组件库名、样式类名等实现细节

如果一条改动离开这些名词就说不清楚，就改用它对**使用者**的意义来描述。
改写方式：问自己「谁的什么问题被解决了 / 谁多了什么能力」，然后只写这个答案。

**2. 用阿拉伯数字编号，每个项目内从 1 重新开始**
条目使用 \`1.\` \`2.\` \`3.\` \`4.\`，不要用 \`-\` 或 \`*\`。项目 A 编到第 3 条，项目 B 仍然从 \`1.\` 重新开始。

**3. 按模块分条，颗粒度要细**
上方每个项目标注了「其中 N 个体量够独立成条」。**这 N 个模块请各写一条**，不要合并。提交次数多的模块内部若有明显不同的工作方向，还可以再拆成两条。
- 标着「体量小」的模块，统一收进最后一条「其他优化与修复」。
- 每一条都要说清楚「做成了什么、带来了什么价值」，而不是「改了哪些代码」。
- 新增能力、打通链路、修复影响用户的缺陷是功能成果，不要降格塞进界面细节类的条目里。

**4. 只写有价值的成果**
忽略版本号变更、合并提交、格式调整、临时提交这类没有信息量的记录。
若某组标注了「另有 N 条同类改动未逐条列出」，说明这块工作量更大，请在描述里体现其分量，但依然只写一条。

**5. 输出前必须自检一遍**
通读你写好的草稿，凡是出现下列形态的内容，一律改写成人话后再输出：
- 带等号或括号的代码写法
- 带单位的数值参数
- 驼峰或下划线拼写的英文标识符、全大写常量
- 任何只有本项目开发者才看得懂的英文缩写
确认一个都没有了，再给出最终结果。

**输出格式（严格遵守）：**

每条由「加粗短标题 + 冒号 + 具体说明」组成。**短标题必须由你根据这条的实际内容自拟。**

下面这段只演示排版，内容与本次周报无关，一个字都不要抄进你的输出：

> **详细工作内容：**
>
> **【项目A名称】**
> 1. **订单导出能力上线：** 用户可按时间范围导出明细，替代了原先手工整理表格的流程。
> 2. **登录异常问题收口：** 修复了多处导致登录失败的情况，报错提示改为用户能看懂的说明。
> 3. **其他优化与修复：** 概括本项目其余零散改动，一句话带过。
>
> **【项目B名称】**
> 1. **权限校验统一：** ……

**下方列出了几个项目，就必须写几段，一个都不能漏。** 即使某个项目提交较少，也要按它标注的条目数写完。

**以下是本周的提交记录（已按项目 / 模块归组，请在此基础上提炼）：**
{{commits}}`,
  },
  {
    id: 'summary',
    name: '归纳提炼（旧版默认）',
    description: '强调从提交里提炼成果、过滤噪音，格式较宽松',
    content: `你是一位资深的技术负责人，擅长从琐碎的开发记录中提炼出真正有价值的工作成果。请根据我提供的 Git 提交记录，生成一份面向团队与上级、重点突出、易于阅读的周报。

**核心原则（务必严格遵守）：**
1. **归纳提炼，拒绝流水账**：绝对不要逐条翻译或罗列每一条 commit。请把围绕同一功能/目标的多条提交（多次开发、修复、优化）**合并归纳成一件完整的工作成果**，用一句话讲清楚“做了什么、达成了什么价值”，而不是“改动了哪些代码”。
2. **聚焦成果与价值**：从使用者或业务视角描述工作意义（解决了什么问题、带来了什么改进、完成了什么能力），而非机械复述技术细节或提交信息原文。
3. **过滤噪音**：忽略无实质意义的提交，例如版本号变更（bump version）、合并提交（merge）、代码格式调整、拼写修正、临时提交（wip）等，不要写进周报。
4. **控制篇幅、突出重点**：每个项目只保留 3~6 条最重要的工作，按重要性排序；零散的小改动请合并到“其他优化与修复”一条里概括，不要展开。
5. **统一使用阿拉伯数字编号**：每个项目下的条目一律用 \`1.\` \`2.\` \`3.\` \`4.\` 编号，**不要用 \`-\` 或 \`*\`**。项目 A 编到第 3 条，项目 B 仍然从 \`1.\` 重新开始。
6. **按项目分类**：提交记录中可能包含多个项目（以 \`[项目名]\` 标识）。请按项目分开叙述，不要把不同项目的内容混在一起。

**周报格式模板：**
---
**详细工作内容：**

**【项目A名称】**
1. **核心工作一：** 一句话概括完成的成果及其价值（可由多条相关提交归纳而来）。
2. **核心工作二：** 一句话概括完成的成果及其价值。
3. **其他优化与修复：** 概括性描述本项目其余的 Bug 修复、重构与零散优化，无需逐条展开。

**【项目B名称】**
1. **核心工作一：** ……

*(如有更多项目，请按相同格式添加；若某项目本周提交很少，可精简为 1~2 条)*
---

**请根据以下 Git 提交记录生成周报（牢记：归纳成果，而非罗列提交）：**
{{commits}}`,
  },
  {
    id: 'classic',
    name: '基础分类（最早版本）',
    description: '只按项目分类罗列，加工最少，接近原始提交',
    content: `你是一个专业的周报助手。请根据我提供的 Git 提交记录，为我生成一份结构清晰、重点突出的周报。

**核心要求：**
1. **按项目严格分类**：提交记录中可能包含多个项目（以 \`[项目名]\` 标识）。请将“详细工作内容”部分按不同项目分开叙述，**不要**将所有内容混在一起。
2. **统一使用阿拉伯数字编号**：每个项目下的条目一律用 \`1.\` \`2.\` \`3.\` \`4.\` 编号，**不要用 \`-\` 或 \`*\`**。项目 A 编到第 3 条，项目 B 仍然从 \`1.\` 重新开始。
3. **使用统一格式**：请严格按照以下提供的模板结构进行生成，确保格式统一、易于阅读。

**周报格式模板：**
---
**详细工作内容：**

**【项目A名称】**
1. **功能/模块A1：** 描述相关提交完成的工作。
2. **功能/模块A2：** 描述相关提交完成的工作。
3. **优化与修复：** 描述相关的Bug修复、代码优化或重构工作。

**【项目B名称】**
1. **功能/模块B1：** 描述相关提交完成的工作。
2. **功能/模块B2：** 描述相关提交完成的工作。
3. **优化与修复：** 描述相关的Bug修复、代码优化或重构工作。

*(如果还有更多项目，请按相同格式添加)*
---

**请根据以下 Git 提交记录生成周报：**
{{commits}}`,
  },
];

export const DEFAULT_TEMPLATE_ID = PROMPT_TEMPLATES[0].id;
export const DEFAULT_PROMPT = PROMPT_TEMPLATES[0].content;

// 只用于升级比对、不在界面出现的历史提示词（开发过程中出现过的中间版本）
export const LEGACY_PROMPTS: string[] = [
  `你是一位资深的技术负责人，要把一周琐碎的开发记录写成一份**给团队和上级看**的周报。请始终记住：读者不写代码，也不知道任何内部代号。

**输入说明：**
下面的提交记录已经按「项目 → 模块」预先归好组。同一模块下的多条记录属于同一件事的多次提交，必须**合并成一条**来写，绝不能拆开逐条罗列。

**五条硬性要求：**

**1. 说人话，不许出现技术黑话**
周报正文里禁止出现下列内容，一个都不行：
- 需求单号、工单号、任务编号（形如 AG-77、BD-01a、MG-05）
- 数据库表名、字段名、类名、方法名、常量名（形如 emr_qc_level_config、finish_reason、WORKFLOW_MAX_STEPS）
- 文件名、目录路径、分支名（形如 DESIGN.md、deploy/xxx.sh、feature/login）
- 框架、库、样式类等实现细节（形如 min-w-0、z-index、CodeMirror、Teleport）

如果一条改动离开这些名词就说不清楚，就改用它对**使用者**的意义来描述。
示例：「修复 emr_qc_level_config 未生效导致 vetoHit 误判」
应写成：「修复病历质控等级判定错误，避免合格病历被误判为不合格」

**2. 用阿拉伯数字编号，每个项目内从 1 重新开始**
条目使用 \`1.\` \`2.\` \`3.\` \`4.\`，不要用 \`-\` 或 \`*\`。项目 A 编到第 3 条，项目 B 仍然从 \`1.\` 重新开始。

**3. 条目数量已经算好了，照着写，不要自行压缩**
下方每个项目标题后面写明了「本项目合计请写 X~Y 条」，每个模块后面写明了「本模块请写成 M~N 条」。**这些数字是硬要求，必须达到，不允许因为想精简而少写。**
- 一个模块要写成好几条时，就按它内部的不同工作方向拆开分别成条，不要硬塞进一句话里。
- 标着「并入『其他优化与修复』」的模块，才合并到最后一条里。
- 围绕同一目标的多次提交合并成一条，讲清楚「做成了什么、带来了什么价值」，而不是「改了哪些代码」。
- **新增能力、打通链路、修复影响用户的缺陷属于功能成果，必须单独成条，不许降格塞进界面细节类的条目里。**

**4. 只写有价值的成果**
忽略版本号变更、合并提交、格式调整、临时提交这类没有信息量的记录。
若某组标注了「另有 N 条同类改动未逐条列出」，说明这块工作量更大，请在描述里体现其分量，但依然只写一条。

**5. 输出前必须自检一遍**
通读你写好的草稿，凡是出现下列形态的内容，一律改写成人话后再输出：
- 带等号或括号的代码写法（如 fit=False、count(*)、body=None）
- 带单位的数值参数（如 160px、8rem、512token）
- 驼峰或下划线拼写的英文标识符、全大写常量
- 任何只有本项目开发者才看得懂的英文缩写
确认一个都没有了，再给出最终结果。

**输出格式（严格遵守）：**

每条由「加粗短标题 + 冒号 + 具体说明」组成。**短标题必须是你根据这条的实际内容自己拟的**，比如「多轮对话打通」「训练配置一键导入」。绝对不要把下面示例里的字面文字抄进去。

**详细工作内容：**

**【项目A名称】**
1. **多轮对话打通：** 修复了会话上下文在对外接口中丢失的问题，用户追问时系统能正确接住上一轮内容。
2. **训练配置一键导入：** 支持粘贴现成的配置文件自动填表，创建训练任务不再需要手工逐项录入。
3. **其他优化与修复：** 概括本项目其余零散改动，一句话带过。

**【项目B名称】**
1. **评测标准细化：** ……

**下方列出了几个项目，就必须写几段，一个都不能漏。** 即使某个项目提交较少，也要按它标注的条目数写完。

**以下是本周的提交记录（已按项目 / 模块归组，请在此基础上提炼）：**
{{commits}}`,
  `你是一位资深的技术负责人，要把一周琐碎的开发记录写成一份**给团队和上级看**的周报。请始终记住：读者不写代码，也不知道任何内部代号。

**输入说明：**
下面的提交记录已经按「项目 → 模块」预先归好组。同一模块下的多条记录属于同一件事的多次提交，必须**合并成一条**来写，绝不能拆开逐条罗列。

**五条硬性要求：**

**1. 说人话，不许出现技术黑话**
周报正文里禁止出现下列内容，一个都不行：
- 需求单号、工单号、任务编号（形如 AG-77、BD-01a、MG-05）
- 数据库表名、字段名、类名、方法名、常量名（形如 emr_qc_level_config、finish_reason、WORKFLOW_MAX_STEPS）
- 文件名、目录路径、分支名（形如 DESIGN.md、deploy/xxx.sh、feature/login）
- 框架、库、样式类等实现细节（形如 min-w-0、z-index、CodeMirror、Teleport）

如果一条改动离开这些名词就说不清楚，就改用它对**使用者**的意义来描述。
示例：「修复 emr_qc_level_config 未生效导致 vetoHit 误判」
应写成：「修复病历质控等级判定错误，避免合格病历被误判为不合格」

**2. 用阿拉伯数字编号，每个项目内从 1 重新开始**
条目使用 \`1.\` \`2.\` \`3.\` \`4.\`，不要用 \`-\` 或 \`*\`。项目 A 编到第 3 条，项目 B 仍然从 \`1.\` 重新开始。

**3. 按「功能」成条，同一个功能必须合并成一条**
划分条目**看的是功能，不是模块、不是提交次数**。同一个功能哪怕跨了好几个模块、有几十次提交，也**只写一条**。

下面这些拆法都是错的：
- 把「训练页配置粘贴导入」和「训练页参数显示优化」写成两条 —— 同属训练创建页改造，应合并成一条。
- 把侧栏、列表页、页签栏、字体、页面宽度分别写成五条 —— 同属界面规范统一，应合并成一条。
- 把「模型仓库整合」和「模型选择器收口」写成两条 —— 同属模型选择体验，应合并成一条。

其余要求：
- **合并不等于删内容**。一条里用分号并列多个具体改动即可，**宁可一条写长，也不要拆成两条**。
- 下方每个模块标了提交次数，只是让你判断分量，**不是让你按模块拆条**；相关的模块请主动并到同一条里。
- 标着「并入『其他优化与修复』」的，一律收进最后一条。
- 每个项目标题后写明了建议条目数，按功能归并后落在那个区间即可。
- **新增能力、打通链路、修复影响用户的缺陷是功能成果，不要降格塞进界面细节类的条目里。**

**4. 只写有价值的成果**
忽略版本号变更、合并提交、格式调整、临时提交这类没有信息量的记录。
若某组标注了「另有 N 条同类改动未逐条列出」，说明这块工作量更大，请在描述里体现其分量，但依然只写一条。

**5. 输出前必须自检一遍**
通读你写好的草稿，凡是出现下列形态的内容，一律改写成人话后再输出：
- 带等号或括号的代码写法（如 fit=False、count(*)、body=None）
- 带单位的数值参数（如 160px、8rem、512token）
- 驼峰或下划线拼写的英文标识符、全大写常量
- 任何只有本项目开发者才看得懂的英文缩写
确认一个都没有了，再给出最终结果。

**输出格式（严格遵守）：**

每条由「加粗短标题 + 冒号 + 具体说明」组成。**短标题必须是你根据这条的实际内容自己拟的**，比如「多轮对话打通」「训练配置一键导入」。绝对不要把下面示例里的字面文字抄进去。

**详细工作内容：**

**【项目A名称】**
1. **多轮对话打通：** 修复了会话上下文在对外接口中丢失的问题，用户追问时系统能正确接住上一轮内容。
2. **训练配置一键导入：** 支持粘贴现成的配置文件自动填表，创建训练任务不再需要手工逐项录入。
3. **其他优化与修复：** 概括本项目其余零散改动，一句话带过。

**【项目B名称】**
1. **评测标准细化：** ……

**下方列出了几个项目，就必须写几段，一个都不能漏。** 即使某个项目提交较少，也要按它标注的条目数写完。

**以下是本周的提交记录（已按项目 / 模块归组，请在此基础上提炼）：**
{{commits}}`,
];

const normalize = (s: string) => s.replace(/\r\n/g, '\n').trim();

export function findTemplateById(id: string | undefined): PromptTemplate | undefined {
  return PROMPT_TEMPLATES.find((t) => t.id === id);
}

// 反查一段提示词是不是某个内置模板（老数据没存 id 时用）
export function findTemplateByContent(content: string): PromptTemplate | undefined {
  const c = normalize(content);
  return PROMPT_TEMPLATES.find((t) => normalize(t.content) === c);
}

// 是不是开发期出现过的中间版本默认提示词
export function isLegacyPrompt(content: string): boolean {
  const c = normalize(content);
  return LEGACY_PROMPTS.some((p) => normalize(p) === c);
}

// ---------------------------------------------------------------------------
// 用户自建模板。内置模板只读、随版本更新；自建模板 id 以 user- 开头，随设置持久化。
// 下面的函数都返回新对象，不修改入参。
// ---------------------------------------------------------------------------

export const USER_TEMPLATE_PREFIX = 'user-';

export interface PromptSettings {
  promptTemplate: string;
  promptTemplateId?: string;
  customTemplates?: PromptTemplate[];
}

export function isUserTemplateId(id: string | undefined): boolean {
  return Boolean(id?.startsWith(USER_TEMPLATE_PREFIX));
}

export function findAnyTemplate(id: string | undefined, userTemplates: PromptTemplate[] = []): PromptTemplate | undefined {
  return findTemplateById(id) ?? userTemplates.find((t) => t.id === id);
}

// 返回错误文案；合法返回 null。重命名时传 selfId，避免和自己比出重名
export function validateTemplateName(name: string, userTemplates: PromptTemplate[] = [], selfId?: string): string | null {
  const n = name.trim();
  if (!n) return '请填写模板名称';
  const taken = [...PROMPT_TEMPLATES, ...userTemplates].some((t) => t.id !== selfId && t.name.trim() === n);
  return taken ? '已有同名模板，换个名称吧' : null;
}

export function hasCommitsVariable(content: string): boolean {
  return content.includes('{{commits}}');
}

export function selectTemplate<T extends PromptSettings>(s: T, id: string): T {
  const tpl = findAnyTemplate(id, s.customTemplates);
  return tpl ? { ...s, promptTemplateId: tpl.id, promptTemplate: tpl.content } : s;
}

export function addUserTemplate<T extends PromptSettings>(
  s: T,
  input: { name: string; description: string; content: string }
): T & { customTemplates: PromptTemplate[] } {
  const tpl: PromptTemplate = {
    id: `${USER_TEMPLATE_PREFIX}${crypto.randomUUID()}`,
    name: input.name.trim(),
    description: input.description.trim(),
    content: input.content,
  };
  return { ...s, customTemplates: [...(s.customTemplates ?? []), tpl], promptTemplateId: tpl.id, promptTemplate: tpl.content };
}

export function updateUserTemplate<T extends PromptSettings>(
  s: T,
  id: string,
  patch: Partial<Pick<PromptTemplate, 'name' | 'description' | 'content'>>
): T & { customTemplates: PromptTemplate[] } {
  const clean = {
    ...patch,
    ...(patch.name !== undefined && { name: patch.name.trim() }),
    ...(patch.description !== undefined && { description: patch.description.trim() }),
  };
  const customTemplates = (s.customTemplates ?? []).map((t) => (t.id === id ? { ...t, ...clean } : t));
  const selected = s.promptTemplateId === id && patch.content !== undefined;
  return { ...s, customTemplates, ...(selected && { promptTemplate: patch.content }) };
}

export function removeUserTemplate<T extends PromptSettings>(s: T, id: string): T & { customTemplates: PromptTemplate[] } {
  const customTemplates = (s.customTemplates ?? []).filter((t) => t.id !== id);
  const wasSelected = s.promptTemplateId === id;
  return {
    ...s,
    customTemplates,
    ...(wasSelected && { promptTemplateId: DEFAULT_TEMPLATE_ID, promptTemplate: DEFAULT_PROMPT }),
  };
}

// 文本框编辑：选中自建模板就直接改它；否则标记为「自定义」，升级时不再覆盖
export function editPromptContent<T extends PromptSettings>(s: T, content: string): T {
  if (isUserTemplateId(s.promptTemplateId) && findAnyTemplate(s.promptTemplateId, s.customTemplates)) {
    return updateUserTemplate(s, s.promptTemplateId!, { content });
  }
  return { ...s, promptTemplate: content, promptTemplateId: CUSTOM_TEMPLATE_ID };
}

// 读取持久化数据时确定当前该用哪个提示词。用的是内置模板就跟随代码更新（否则持久化会把旧
// 提示词永久固定住，改模板对老用户完全无效）；自建模板取其最新内容；用户改过的「自定义」原样保留。
export function resolvePromptTemplate(raw: any): any {
  const content = typeof raw?.promptTemplate === 'string' ? raw.promptTemplate : '';
  let id: string | undefined = raw?.promptTemplateId;

  if (!id) {
    // 老数据没存 id：内容只要是任一内置模板或开发期的中间版本，就说明用户
    // 从没自己改过，升级到最新默认。注意不能反查成那个旧模板的 id——那会把
    // 老用户永久钉死在最早的模板上，再也拿不到新默认。
    // 主动选过模板的人存了 id，走下面的分支，不受这里影响。
    const untouched = !content || isLegacyPrompt(content) || !!findTemplateByContent(content);
    id = untouched ? DEFAULT_TEMPLATE_ID : CUSTOM_TEMPLATE_ID;
  }

  if (id === CUSTOM_TEMPLATE_ID) {
    return { ...raw, promptTemplateId: CUSTOM_TEMPLATE_ID };
  }

  const template = findAnyTemplate(id, raw?.customTemplates) ?? findTemplateById(DEFAULT_TEMPLATE_ID)!;
  return { ...raw, promptTemplateId: template.id, promptTemplate: template.content };
}
