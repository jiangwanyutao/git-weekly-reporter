import { useState } from 'react';
import { PlusIcon, PencilSimpleIcon, TrashIcon, WarningIcon, FloppyDiskIcon } from '@phosphor-icons/react';
import type { AppSettings } from '@/types';
import {
  PROMPT_TEMPLATES,
  CUSTOM_TEMPLATE_ID,
  type PromptTemplate,
  addUserTemplate,
  editPromptContent,
  hasCommitsVariable,
  removeUserTemplate,
  selectTemplate,
  updateUserTemplate,
  validateTemplateName,
} from '@/store/prompt-templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Props = {
  settings: AppSettings;
  onChange: (update: (prev: AppSettings) => AppSettings) => void;
};

type Draft = { mode: 'create' | 'edit'; id?: string; name: string; description: string; content: string };

const SAVE_HINT = '记得点击「保存配置」后生效';

export function PromptTemplatePicker({ settings, onChange }: Props) {
  const userTemplates = settings.customTemplates ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const openCreate = (content: string) => {
    setNameError(null);
    setDraft({ mode: 'create', name: '', description: '', content });
  };
  const openEdit = (t: PromptTemplate) => {
    setNameError(null);
    setDraft({ mode: 'edit', id: t.id, name: t.name, description: t.description, content: t.content });
  };

  const submitDraft = () => {
    if (!draft) return;
    const error = validateTemplateName(draft.name, userTemplates, draft.id);
    if (error) {
      setNameError(error);
      return;
    }
    if (draft.mode === 'create') {
      onChange((prev) => addUserTemplate(prev, draft));
      toast({ title: `已新建模板「${draft.name.trim()}」`, description: `已切换到该模板，${SAVE_HINT}` });
    } else {
      onChange((prev) => updateUserTemplate(prev, draft.id!, { name: draft.name, description: draft.description }));
      toast({ title: '模板信息已更新', description: SAVE_HINT });
    }
    setDraft(null);
  };

  const deleteTemplate = (t: PromptTemplate) => {
    if (!window.confirm(`确定删除模板「${t.name}」？删除后无法恢复。`)) return;
    const wasSelected = settings.promptTemplateId === t.id;
    onChange((prev) => removeUserTemplate(prev, t.id));
    toast({ title: `已删除模板「${t.name}」`, description: wasSelected ? `已切回默认模板，${SAVE_HINT}` : SAVE_HINT });
  };

  const choose = (t: PromptTemplate) => {
    onChange((prev) => selectTemplate(prev, t.id));
    toast({ title: `已切换到「${t.name}」`, description: SAVE_HINT });
  };

  const renderCard = (t: PromptTemplate, isUser: boolean) => {
    const on = t.id === settings.promptTemplateId;
    return (
      <div
        key={t.id}
        role="button"
        tabIndex={0}
        onClick={() => choose(t)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose(t))}
        className={cn(
          'group flex cursor-pointer items-start gap-2.5 rounded-[7px] border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring',
          on ? 'border-primary bg-accent' : 'border-border hover:bg-muted/60'
        )}
      >
        <span className={cn('mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px]', on ? 'border-[5px] border-primary' : 'border-input')} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold">{t.name}</span>
            {isUser && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">自建</span>
            )}
          </span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{t.description || '没有说明'}</span>
        </span>
        {isUser && (
          <span className="flex shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              title="重命名"
              onClick={() => openEdit(t)}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <PencilSimpleIcon size={14} />
            </button>
            <button
              type="button"
              title="删除"
              onClick={() => deleteTemplate(t)}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
            >
              <TrashIcon size={14} />
            </button>
          </span>
        )}
      </div>
    );
  };

  const draftMissingCommits = draft?.mode === 'create' && !hasCommitsVariable(draft.content);

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {PROMPT_TEMPLATES.map((t) => renderCard(t, false))}
        {userTemplates.map((t) => renderCard(t, true))}
        <button
          type="button"
          onClick={() => openCreate(settings.promptTemplate)}
          className="flex min-h-[58px] items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-input text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <PlusIcon size={15} />
          新建模板
        </button>
      </div>

      {settings.promptTemplateId === CUSTOM_TEMPLATE_ID && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span>当前是修改过的提示词，升级时不会被覆盖。</span>
          <Button variant="outline" size="sm" className="h-7" onClick={() => openCreate(settings.promptTemplate)}>
            <FloppyDiskIcon size={13} />
            保存为模板
          </Button>
        </div>
      )}

      <Textarea
        className="mt-3 h-[220px] resize-none font-mono text-xs"
        value={settings.promptTemplate}
        onChange={(e) => {
          const content = e.target.value;
          onChange((prev) => editPromptContent(prev, content));
        }}
      />
      {hasCommitsVariable(settings.promptTemplate) ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          可用变量 <code className="font-mono">{'{{commits}}'}</code>，将替换为归组后的 Git 提交记录。选中自建模板时，这里的修改会直接存进该模板。
        </p>
      ) : (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warning">
          <WarningIcon size={13} />
          提示词里没有 <code className="font-mono">{'{{commits}}'}</code>，生成时模型拿不到提交记录。
        </p>
      )}

      <Dialog open={Boolean(draft)} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{draft?.mode === 'create' ? '新建提示词模板' : '编辑模板信息'}</DialogTitle>
            <DialogDescription>
              {draft?.mode === 'create' ? '内容默认带入当前正在使用的提示词，可以直接改。' : '模板内容在下方文本框里修改。'}
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3 py-1">
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-name">名称</Label>
                <Input
                  id="tpl-name"
                  autoFocus
                  value={draft.name}
                  maxLength={30}
                  placeholder="例如：给老板看的精简版"
                  onChange={(e) => {
                    setDraft({ ...draft, name: e.target.value });
                    setNameError(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && submitDraft()}
                />
                {nameError && <p className="text-xs text-destructive">{nameError}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-desc">说明（可选）</Label>
                <Input
                  id="tpl-desc"
                  value={draft.description}
                  maxLength={60}
                  placeholder="一句话说明这个模板适合什么场景"
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              {draft.mode === 'create' && (
                <div className="grid gap-1.5">
                  <Label htmlFor="tpl-content">提示词内容</Label>
                  <Textarea
                    id="tpl-content"
                    className="h-[200px] resize-none font-mono text-xs"
                    value={draft.content}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  />
                  {draftMissingCommits && (
                    <p className="flex items-center gap-1.5 text-xs text-warning">
                      <WarningIcon size={13} />
                      内容里没有 <code className="font-mono">{'{{commits}}'}</code>，生成时模型拿不到提交记录。
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button onClick={submitDraft}>{draft?.mode === 'create' ? '创建并使用' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
