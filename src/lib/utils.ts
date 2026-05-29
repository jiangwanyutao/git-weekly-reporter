import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 归一化代理地址：留空返回 undefined；无协议则补 http://
export function normalizeProxyUrl(raw?: string): string | undefined {
  const v = (raw || '').trim();
  if (!v) return undefined;
  return /^https?:\/\//i.test(v) ? v : `http://${v}`;
}
