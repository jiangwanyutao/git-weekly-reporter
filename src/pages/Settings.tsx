
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FolderPlus, Trash2, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from '@/hooks/use-toast';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function SettingsPage() {
  const { settings, updateSettings, projects, addProject, removeProject } = useAppStore();
  const [localSettings, setLocalSettings] = useState(settings);

  const handleSave = () => {
    updateSettings(localSettings);
    toast({
      title: "设置已保存",
      description: "您的配置已成功更新。",
    });
  };

  const handleAddProject = async () => {
    try {
      if (!isTauri) {
        // Web 模式下的 Mock 行为
        const mockPath = `C:\\Mock\\Project\\${Math.floor(Math.random() * 1000)}`;
        addProject(mockPath);
        toast({ title: "Mock项目已添加", description: mockPath });
        return;
      }

      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        addProject(selected);
        toast({ title: "项目已添加", description: selected });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "添加失败", variant: "destructive" });
    }
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-hidden">
      <div className="flex justify-between items-center shrink-0">
         <h1 className="text-3xl font-bold">系统配置</h1>
         <Button onClick={handleSave} size="lg">
          <Save className="mr-2 h-4 w-4" />
          保存所有配置
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="pr-4 pb-6 space-y-8">
          {/* 1. Git 项目管理 */}
          <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Git 项目管理</CardTitle>
              <Button onClick={handleAddProject} variant="outline" size="sm">
                <FolderPlus className="mr-2 h-4 w-4" />
                添加项目
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {projects.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    暂无项目，请点击右上角添加
                  </div>
                ) : (
                  projects.map((project) => (
                    <div key={project.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors group">
                      <div>
                        <div className="font-medium">{project.name}</div>
                        <div className="text-xs text-muted-foreground group-hover:text-accent-foreground/80 transition-colors">{project.path}</div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive/90 group-hover:bg-destructive/10"
                        onClick={() => removeProject(project.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* 2. GLM 模型配置 */}
          <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader>
              <CardTitle>模型配置 (GLM-4.7)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={localSettings.glmApiKey}
                  onChange={(e) => setLocalSettings({ ...localSettings, glmApiKey: e.target.value })}
                  placeholder="请输入智谱 AI 的 API Key"
                />
                <p className="text-xs text-muted-foreground">
                  申请地址: <a href="https://bigmodel.cn" target="_blank" className="underline">bigmodel.cn</a>
                </p>
              </div>
              <div className="space-y-2">
                <Label>Git 作者名称 (用于筛选)</Label>
                <Input
                  value={localSettings.authorName}
                  onChange={(e) => setLocalSettings({ ...localSettings, authorName: e.target.value })}
                  placeholder="例如: Zhang San"
                />
              </div>
            </CardContent>
          </Card>

          {/* 3. 提示词配置 */}
          <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader>
              <CardTitle>提示词模板</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Textarea
                  className="min-h-[200px] font-mono text-sm"
                  value={localSettings.promptTemplate}
                  onChange={(e) => setLocalSettings({ ...localSettings, promptTemplate: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  可用变量: <code>{`{{commits}}`}</code> - 将被替换为具体的 Git 提交记录
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
