import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 项目色点：同一项目稳定取同一色
const PROJECT_DOTS = ['bg-primary', 'bg-chart-4', 'bg-chart-2', 'bg-chart-5', 'bg-chart-3'];
export function projectDot(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PROJECT_DOTS[h % PROJECT_DOTS.length];
}
