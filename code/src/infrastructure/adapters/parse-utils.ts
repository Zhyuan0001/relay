import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { AdapterProbe } from '../../domain/types.ts';
import { join } from 'node:path';

export function walkFiles(root: string, predicate: (path: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && predicate(path)) found.push(path);
    }
  };
  walk(root);
  return found;
}

const MIN_TIME = Date.UTC(1900, 0, 1);
const MAX_TIME = Date.UTC(2200, 0, 1);

function fromMs(ms: number, fallback: string): string {
  if (!Number.isFinite(ms) || ms < MIN_TIME || ms > MAX_TIME) return fallback;
  try {
    return new Date(ms).toISOString();
  } catch {
    return fallback;
  }
}

export function toIso(value: unknown, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e17 ? value / 1e6 : value > 1e12 ? value : value * 1000;
    return fromMs(ms, fallback);
  }
  if (typeof value === 'string' && value.trim()) {
    let text = value.trim().replace(' ', 'T');
    const fractional = text.match(/^(.*\.)(\d+)(Z|[+-]\d{2}:?\d{2})$/);
    if (fractional) text = `${fractional[1]}${fractional[2].slice(0, 3)}${fractional[3]}`;
    const ms = Date.parse(text);
    if (!Number.isNaN(ms)) return fromMs(ms, fallback);
  }
  return fallback;
}

export interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
  [key: string]: unknown;
}

export function contentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) {
    return content.filter((item): item is ContentBlock => Boolean(item) && typeof item === 'object');
  }
  return [];
}

export function blockText(block: ContentBlock): string | undefined {
  if (typeof block.text === 'string') return block.text;
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    const text = block.content
      .map((item) => (item && typeof item === 'object' ? (item as ContentBlock).text : undefined))
      .filter((item): item is string => typeof item === 'string')
      .join('\n');
    return text || undefined;
  }
  return undefined;
}

export function summarizeText(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export function fileMtimeIso(path: string): string {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export function readLines(path: string): string[] {
  return readFileSync(path, 'utf8').split(/\r?\n/);
}


function versionOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function probeJsonl(path: string, format: string): AdapterProbe {
  let lines: string[];
  try {
    lines = readLines(path).slice(0, 60);
  } catch (error) {
    return { format, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  let parsed = 0;
  let version: string | undefined;
  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    try {
      const object = JSON.parse(raw) as Record<string, unknown>;
      parsed += 1;
      if (!version) {
        version =
          versionOf(object.version) ??
          versionOf(object.cliVersion) ??
          versionOf(object.cli_version) ??
          versionOf(object.appVersion) ??
          versionOf(object.schemaVersion) ??
          versionOf((object.payload as Record<string, unknown> | undefined)?.version) ??
          versionOf((object.payload as Record<string, unknown> | undefined)?.cli_version);
      }
    } catch {
      continue;
    }
    if (version) break;
  }
  return { format, version, ok: parsed > 0, detail: parsed ? undefined : '前 60 行没有可解析 JSON' };
}
