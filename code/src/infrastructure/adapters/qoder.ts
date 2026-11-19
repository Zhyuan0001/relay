import { basename } from 'node:path';
import type {
  AgentKind,
  LogAdapter,
  ParsedSession,
  ParseError,
  RawEvent,
  Role,
} from '../../domain/types.ts';
import { isEditTool, editFilePath } from '../../domain/rules.ts';
import { stableEventId } from '../../shared/hash.ts';
import {
  blockText,
  contentBlocks,
  fileMtimeIso,
  readLines,
  probeJsonl,
  summarizeText,
  toIso,
  walkFiles,
  type ContentBlock,
} from './parse-utils.ts';

interface TranscriptLine {
  type?: string;
  sessionId?: string;
  directories?: string[];
  cwd?: string;
  timestamp?: unknown;
  model?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  origin?: { kind?: string };
  humanInput?: unknown;
  promptId?: string;
  toolUseResult?: unknown;
  message?: {
    role?: string;
    content?: unknown;
    timestamp?: unknown;
  };
}

export function parseTranscriptJsonl(
  path: string,
  agent: AgentKind,
  originKind: ParsedSession['originKind'] = 'real',
): ParsedSession[] {
  const lines = readLines(path);
  const fallbackTime = fileMtimeIso(path);
  let lastTime: string | undefined;
  let sessionId = basename(path, '.jsonl');
  let workspacePath: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let title: string | undefined;
  const events: RawEvent[] = [];
  const errors: ParseError[] = [];

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const raw = lines[lineNo].trim();
    if (!raw) continue;
    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(raw) as TranscriptLine;
    } catch (error) {
      errors.push({
        line: lineNo + 1,
        message: error instanceof Error ? error.message : String(error),
        sample: raw.slice(0, 120),
      });
      continue;
    }

    if (typeof parsed.sessionId === 'string' && parsed.sessionId) sessionId = parsed.sessionId;
    const candidateWorkspace = parsed.cwd ?? parsed.directories?.[0];
    if (candidateWorkspace) workspacePath = candidateWorkspace;

    const hasTimestamp = parsed.timestamp !== undefined || parsed.message?.timestamp !== undefined;
    const occurredAt = hasTimestamp
      ? toIso(parsed.timestamp ?? parsed.message?.timestamp, lastTime ?? fallbackTime)
      : (lastTime ?? fallbackTime);
    lastTime = occurredAt;
    if (!startedAt) startedAt = occurredAt;
    endedAt = occurredAt;

    const message = parsed.message;
    if (!message) continue;

    const role = (message.role ?? parsed.type ?? 'assistant') as Role;
    const toolTurn = parsed.toolUseResult !== undefined;
    const human =
      agent === 'claude-code' ||
      parsed.origin?.kind === 'human' ||
      parsed.humanInput !== undefined ||
      parsed.promptId !== undefined;
    const blocks = contentBlocks(message.content);
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const produced = eventsFromBlock({
        block: blocks[blockIndex],
        sessionId,
        agent,
        path,
        lineNo: lineNo + 1,
        blockIndex,
        occurredAt,
        role,
        human,
        toolTurn,
        uuid: parsed.uuid,
      });
      for (const event of produced) {
        events.push(event);
        if (!title && event.type === 'prompt' && event.text) title = summarizeText(event.text, 80);
      }
    }
  }

  if (!startedAt) startedAt = fallbackTime;
  return [
    {
      agent,
      sessionId,
      workspacePath,
      startedAt,
      endedAt,
      title,
      sourcePath: path,
      originKind,
      events,
      errors,
    },
  ];
}

export function eventsFromBlock(input: {
  block: ContentBlock;
  sessionId: string;
  agent: AgentKind;
  path: string;
  lineNo: number;
  blockIndex: number;
  occurredAt: string;
  role: Role;
  human: boolean;
  toolTurn?: boolean;
  uuid?: string;
}): RawEvent[] {
  const { block, sessionId, agent, path, lineNo, blockIndex, occurredAt, role, human, toolTurn, uuid } = input;
  const type = block.type ?? 'unknown';
  const provenance = { agent, sourcePath: path, lineNo, blockIndex, occurredAt };
  const idBase = uuid ?? `${lineNo}`;

  if (type === 'text') {
    const text = blockText(block);
    if (!text) return [];
    if (role === 'user' && toolTurn) {
      return [
        {
          id: stableEventId([sessionId, idBase, blockIndex, 'tool_result', text]),
          sessionId,
          type: 'tool_result',
          occurredAt,
          role: 'tool',
          output: text,
          success: block.is_error !== true,
          provenance,
        },
      ];
    }
    const eventType = role === 'user' ? (human ? 'prompt' : 'text') : 'text';
    return [
      {
        id: stableEventId([sessionId, idBase, blockIndex, eventType, text]),
        sessionId,
        type: eventType,
        occurredAt,
        role,
        text,
        provenance,
      },
    ];
  }

  if (type === 'thinking') {
    const text = blockText(block);
    if (!text) return [];
    return [
      {
        id: stableEventId([sessionId, idBase, blockIndex, 'thinking', text]),
        sessionId,
        type: 'thinking',
        occurredAt,
        role: role === 'user' ? 'assistant' : role,
        text,
        provenance,
      },
    ];
  }

  if (type === 'tool_use') {
    const tool = typeof block.name === 'string' ? block.name : 'unknown-tool';
    const callId = stableEventId([
      sessionId,
      idBase,
      blockIndex,
      'tool_call',
      tool,
      JSON.stringify(block.input ?? {}),
    ]);
    const events: RawEvent[] = [
      {
        id: callId,
        sessionId,
        type: 'tool_call',
        occurredAt,
        tool,
        input: block.input,
        provenance,
      },
    ];
    if (isEditTool(tool)) {
      events.push({
        id: stableEventId([callId, 'edit']),
        sessionId,
        type: 'edit',
        occurredAt,
        tool,
        input: block.input,
        filePath: editFilePath(block.input),
        provenance,
      });
    }
    return events;
  }

  if (type === 'tool_result') {
    const output = blockText(block);
    const success = block.is_error !== true;
    return [
      {
        id: stableEventId([sessionId, idBase, blockIndex, 'tool_result', output ?? '', success ? 1 : 0]),
        sessionId,
        type: 'tool_result',
        occurredAt,
        role: 'tool',
        output,
        success,
        provenance,
      },
    ];
  }

  return [
    {
      id: stableEventId([sessionId, idBase, blockIndex, type]),
      sessionId,
      type: 'unknown',
      occurredAt,
      text: summarizeText(JSON.stringify(block).slice(0, 300)),
      provenance,
    },
  ];
}

export class QoderAdapter implements LogAdapter {
  id: AgentKind = 'qoder';

  discover(root: string): string[] {
    return walkFiles(root, (path) => path.endsWith('.jsonl'));
  }

  parse(path: string): ParsedSession[] {
    return parseTranscriptJsonl(path, 'qoder');
  }

  probe(path: string) {
    return probeJsonl(path, 'qoder-jsonl');
  }
}

export class ClaudeFixtureAdapter implements LogAdapter {
  id: AgentKind = 'claude-code';

  discover(root: string): string[] {
    return walkFiles(root, (path) => path.endsWith('.jsonl'));
  }

  parse(path: string): ParsedSession[] {
    return parseTranscriptJsonl(path, 'claude-code', 'fixture');
  }

  probe(path: string) {
    return probeJsonl(path, 'claude-jsonl');
  }
}

export class ClaudeCodeAdapter implements LogAdapter {
  id: AgentKind = 'claude-code';

  discover(root: string): string[] {
    return walkFiles(root, (path) => path.endsWith('.jsonl'));
  }

  parse(path: string): ParsedSession[] {
    return parseTranscriptJsonl(path, 'claude-code', 'real');
  }

  probe(path: string) {
    return probeJsonl(path, 'claude-jsonl');
  }
}
