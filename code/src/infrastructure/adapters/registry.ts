import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AdapterProbe, AgentKind, LogAdapter } from '../../domain/types.ts';
import { QoderAdapter, ClaudeCodeAdapter } from './qoder.ts';
import { AntigravitySummaryAdapter } from './antigravity.ts';
import { CodexAdapter } from './codex.ts';
import { RooCodeAdapter, ClineAdapter } from './roo.ts';
import { GeminiAdapter } from './gemini.ts';
import { DeepSeekHarnessAdapter } from './deepseek-harness.ts';
import { GenericJsonlAdapter } from './generic.ts';
import { AiderAdapter } from './aider.ts';

export interface HarnessCapabilities {
  sessions: boolean | 'summary' | 'generic' | 'planned';
  hooks: boolean | 'planned';
  mcp: boolean | 'planned';
  rules: string[];
  resume: boolean;
}

export interface HarnessDefinition {
  id: AgentKind;
  name: string;
  source: 'real' | 'summary' | 'generic' | 'planned' | 'hook-only';
  adapter?: LogAdapter;
  roots: string[];
  capabilities: HarnessCapabilities;
  note?: string;
}

export interface HarnessCatalogEntry {
  id: AgentKind;
  name: string;
  source: HarnessDefinition['source'];
  status: string;
  installed: boolean;
  sources: number;
  probe?: AdapterProbe;
  adapter: boolean;
  roots: string[];
  capabilities: HarnessCapabilities;
  note?: string;
}

const home = homedir();

function roots(...items: string[]): string[] {
  return items.map((item) => join(home, item));
}

export function harnessDefinitions(): HarnessDefinition[] {
  return [
    {
      id: 'qoder',
      name: 'Qoder',
      source: 'real',
      adapter: new QoderAdapter(),
      roots: roots('.qoder-cn/projects'),
      capabilities: { sessions: true, hooks: true, mcp: true, rules: ['AGENTS.md', '.qoder'], resume: false },
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      source: 'real',
      adapter: new ClaudeCodeAdapter(),
      roots: roots('.claude/projects'),
      capabilities: { sessions: true, hooks: true, mcp: true, rules: ['CLAUDE.md'], resume: true },
    },
    {
      id: 'codex',
      name: 'Codex',
      source: 'real',
      adapter: new CodexAdapter(),
      roots: roots('.codex/sessions'),
      capabilities: { sessions: true, hooks: true, mcp: true, rules: ['AGENTS.md'], resume: true },
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      source: 'summary',
      adapter: new AntigravitySummaryAdapter(),
      roots: roots('.gemini/antigravity'),
      capabilities: { sessions: 'summary', hooks: false, mcp: false, rules: ['AGENTS.md'], resume: true },
    },
    {
      id: 'roo-code',
      name: 'Roo Code',
      source: 'real',
      adapter: new RooCodeAdapter(),
      roots: roots('.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks'),
      capabilities: { sessions: true, hooks: false, mcp: true, rules: ['.roo/rules'], resume: false },
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      source: 'real',
      adapter: new GeminiAdapter(),
      roots: roots('.gemini'),
      capabilities: { sessions: true, hooks: false, mcp: true, rules: ['GEMINI.md'], resume: true },
    },
    {
      id: 'deepseek-harness',
      name: 'DeepSeek Harness',
      source: 'real',
      adapter: new DeepSeekHarnessAdapter(),
      roots: roots('.dsh', '.deepseek', '.config/deepseek-harness', '.local/share/deepseek-harness'),
      capabilities: { sessions: true, hooks: true, mcp: true, rules: ['AGENTS.md'], resume: true },
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      source: 'generic',
      adapter: new GenericJsonlAdapter(),
      roots: roots('.local/share/opencode', '.config/opencode'),
      capabilities: { sessions: 'generic', hooks: false, mcp: true, rules: ['AGENTS.md'], resume: true },
      note: '通用 JSONL 适配，格式按实际探测降级',
    },
    {
      id: 'cline',
      name: 'Cline',
      source: 'real',
      adapter: new ClineAdapter(),
      roots: roots('.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks'),
      capabilities: { sessions: true, hooks: false, mcp: true, rules: ['.clinerules'], resume: false },
    },
    {
      id: 'cursor',
      name: 'Cursor',
      source: 'hook-only',
      roots: roots('.cursor'),
      capabilities: { sessions: false, hooks: true, mcp: true, rules: ['.cursor/rules'], resume: false },
      note: 'state.vscdb 未公开，v1 只规划 hooks 采集',
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      source: 'generic',
      adapter: new GenericJsonlAdapter(),
      roots: roots('.windsurf', '.codeium/windsurf'),
      capabilities: { sessions: 'generic', hooks: false, mcp: true, rules: ['.windsurfrules'], resume: false },
    },
    {
      id: 'aider',
      name: 'Aider',
      source: 'real',
      adapter: new AiderAdapter(),
      roots: [],
      capabilities: { sessions: true, hooks: false, mcp: false, rules: ['CONVENTIONS.md'], resume: false },
      note: '按仓库 .aider.chat.history.md 解析，需手动指定仓库目录',
    },
    {
      id: 'kimi',
      name: 'Kimi Code',
      source: 'generic',
      adapter: new GenericJsonlAdapter(),
      roots: roots('.kimi'),
      capabilities: { sessions: 'generic', hooks: false, mcp: true, rules: ['AGENTS.md'], resume: true },
    },
    {
      id: 'kiro',
      name: 'Kiro',
      source: 'generic',
      adapter: new GenericJsonlAdapter(),
      roots: roots('.kiro'),
      capabilities: { sessions: 'generic', hooks: false, mcp: true, rules: ['AGENTS.md'], resume: false },
    },
    {
      id: 'openclaw',
      name: 'OpenClaw',
      source: 'generic',
      adapter: new GenericJsonlAdapter(),
      roots: roots('.openclaw'),
      capabilities: { sessions: 'generic', hooks: true, mcp: true, rules: ['AGENTS.md', 'SOUL.md'], resume: true },
    },
    {
      id: 'hermes',
      name: 'Hermes',
      source: 'generic',
      adapter: new GenericJsonlAdapter(),
      roots: roots('.hermes'),
      capabilities: { sessions: 'generic', hooks: true, mcp: true, rules: ['MEMORY.md', 'USER.md'], resume: false },
    },
    {
      id: 'pi',
      name: 'Pi',
      source: 'generic',
      adapter: new GenericJsonlAdapter(),
      roots: roots('.pi'),
      capabilities: { sessions: 'generic', hooks: false, mcp: true, rules: ['AGENTS.md'], resume: false },
    },
    {
      id: 'minimax',
      name: 'MiniMax Code',
      source: 'generic',
      adapter: new GenericJsonlAdapter(),
      roots: roots('.minimax'),
      capabilities: { sessions: 'generic', hooks: false, mcp: true, rules: ['AGENTS.md'], resume: false },
    },
    {
      id: 'grok',
      name: 'Grok',
      source: 'generic',
      adapter: new GenericJsonlAdapter(),
      roots: roots('.grok'),
      capabilities: { sessions: 'generic', hooks: true, mcp: true, rules: ['AGENTS.md'], resume: true },
    },
    {
      id: 'devin',
      name: 'Devin',
      source: 'planned',
      roots: [],
      capabilities: { sessions: false, hooks: false, mcp: true, rules: ['AGENTS.md'], resume: false },
    },
  ];
}

function sourcesFor(definition: HarnessDefinition): string[] {
  if (!definition.adapter) return [];
  const found: string[] = [];
  for (const root of definition.roots) {
    if (!existsSync(root)) continue;
    try {
      found.push(...definition.adapter.discover(root));
    } catch {
      // ignore unreadable root
    }
  }
  return found;
}

function probeFor(definition: HarnessDefinition, sources: string[]): AdapterProbe | undefined {
  if (!definition.adapter?.probe || !sources.length) return undefined;
  try {
    return definition.adapter.probe(sources[0]);
  } catch (error) {
    return { format: 'unknown', ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function statusFor(
  definition: HarnessDefinition,
  sourceCount: number,
  installed: boolean,
  probe: AdapterProbe | undefined,
): string {
  if (definition.adapter && sourceCount > 0) {
    if (probe && !probe.ok) return 'format-unknown';
    if (definition.source === 'summary') return 'summary';
    if (definition.source === 'generic') return 'generic';
    return 'ready';
  }
  if (definition.source === 'hook-only') return 'hook-only';
  if (definition.adapter) return 'adapter';
  if (installed) return 'installed';
  return 'planned';
}

export function catalog(): HarnessCatalogEntry[] {
  return harnessDefinitions().map((definition) => {
    const sources = sourcesFor(definition);
    const rootsExist = definition.roots.some((root) => existsSync(root));
    const installed =
      sources.length > 0 || (rootsExist && (definition.source === 'planned' || definition.source === 'hook-only'));
    const probe = probeFor(definition, sources);
    return {
      id: definition.id,
      name: definition.name,
      source: definition.source,
      status: statusFor(definition, sources.length, installed, probe),
      installed,
      sources: sources.length,
      probe,
      adapter: Boolean(definition.adapter),
      roots: definition.roots.map((root) => root.replace(home, '~')),
      capabilities: definition.capabilities,
      note: definition.note,
    };
  });
}

export interface AutoSource {
  id: AgentKind;
  name: string;
  adapter: LogAdapter;
  roots: string[];
}

export function autoSources(): AutoSource[] {
  const result: AutoSource[] = [];
  for (const definition of harnessDefinitions()) {
    if (!definition.adapter) continue;
    const rootsWithSources = definition.roots.filter((root) => {
      if (!existsSync(root)) return false;
      try {
        return definition.adapter!.discover(root).length > 0;
      } catch {
        return false;
      }
    });
    if (rootsWithSources.length) {
      const probe = probeFor(definition, definition.adapter.discover(rootsWithSources[0]));
      if (probe && !probe.ok) continue;
      result.push({ id: definition.id, name: definition.name, adapter: definition.adapter, roots: rootsWithSources });
    }
  }
  return result;
}
