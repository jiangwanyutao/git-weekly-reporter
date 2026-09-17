// 批量导入项目用到的纯函数（不依赖 Tauri，便于单测）

export interface ImportCandidate {
  path: string;
  name: string;
  added: boolean; // 已经在项目列表里
}

// 取路径最后一段作为项目名，兼容 \ 和 / 以及结尾斜杠
export function basename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

// 比较路径时忽略分隔符、结尾斜杠和大小写（Windows、macOS 默认文件系统都不区分大小写）
const normalizePath = (path: string) => path.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();

export function planImport(found: string[], existingPaths: string[]): ImportCandidate[] {
  const existing = new Set(existingPaths.map(normalizePath));
  return found.map((path) => ({ path, name: basename(path), added: existing.has(normalizePath(path)) }));
}
