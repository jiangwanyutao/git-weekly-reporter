import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FolderPlus, Trash2, Save, Settings2, Key, MessageSquare, GitBranch, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function SettingsPage() {
  const { settings, updateSettings, projects, addProject, removeProject } = useAppStore();
  const [localSettings, setLocalSettings] = useState(settings);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    updateSettings(localSettings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    toast({
      title: "Settings saved",
      description: "Your configuration has been updated.",
    });
  };

  const handleAddProject = async () => {
    try {
      if (!isTauri) {
        const mockPath = `C:\\Mock\\Project\\${Math.floor(Math.random() * 1000)}`;
        addProject(mockPath);
        toast({ title: "Mock project added", description: mockPath });
        return;
      }

      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        addProject(selected);
        toast({ title: "Project added", description: selected });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Failed to add", variant: "destructive" });
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-6 py-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              Settings
            </h1>
            <p className="text-sm text-muted-foreground">
              Configure your projects, API keys, and prompts
            </p>
          </div>
          <Button onClick={handleSave} className="h-9">
            {saved ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2 text-primary-foreground" />
                Saved
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </header>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6 max-w-4xl">
          {/* Git Projects */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <GitBranch className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-medium">Git Projects</h2>
                  <p className="text-xs text-muted-foreground">
                    Manage repositories to track
                  </p>
                </div>
              </div>
              <Button onClick={handleAddProject} variant="outline" size="sm" className="h-8">
                <FolderPlus className="h-4 w-4 mr-2" />
                Add Project
              </Button>
            </div>

            <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
              {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <GitBranch className="h-8 w-8 opacity-20 mb-3" />
                  <p className="text-sm">No projects added</p>
                  <p className="text-xs mt-1">Click "Add Project" to get started</p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      className="flex items-center justify-between p-4 hover:bg-accent/30 transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 shrink-0">
                          <GitBranch className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{project.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{project.path}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                        onClick={() => removeProject(project.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* API Configuration */}
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Key className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="font-medium">Model Configuration</h2>
                <p className="text-xs text-muted-foreground">
                  Configure your GLM API credentials
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-4">
              <div className="space-y-2">
                <Label className="text-sm">API Key</Label>
                <div className="relative">
                  <Input
                    type="password"
                    value={localSettings.glmApiKey}
                    onChange={(e) => setLocalSettings({ ...localSettings, glmApiKey: e.target.value })}
                    placeholder="Enter your GLM API Key"
                    className="pr-24 bg-background/50"
                  />
                  {localSettings.glmApiKey && (
                    <Badge
                      variant="secondary"
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-6 text-[10px]"
                    >
                      Configured
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  Get your API key from{' '}
                  <a
                    href="https://bigmodel.cn"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    bigmodel.cn
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Author Filter</Label>
                <Input
                  value={localSettings.authorName}
                  onChange={(e) => setLocalSettings({ ...localSettings, authorName: e.target.value })}
                  placeholder="e.g., John Doe"
                  className="bg-background/50"
                />
                <p className="text-xs text-muted-foreground">
                  Filter commits by author name (optional)
                </p>
              </div>
            </div>
          </section>

          {/* Prompt Template */}
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <MessageSquare className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="font-medium">Prompt Template</h2>
                <p className="text-xs text-muted-foreground">
                  Customize the AI generation prompt
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3">
              <Textarea
                className="min-h-[200px] font-mono text-sm bg-background/50 resize-none"
                value={localSettings.promptTemplate}
                onChange={(e) => setLocalSettings({ ...localSettings, promptTemplate: e.target.value })}
                placeholder="Enter your prompt template..."
              />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Available variables:</span>
                <Badge variant="outline" className="h-5 text-[10px] font-mono">
                  {'{{commits}}'}
                </Badge>
                <Badge variant="outline" className="h-5 text-[10px] font-mono">
                  {'{{context}}'}
                </Badge>
              </div>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
