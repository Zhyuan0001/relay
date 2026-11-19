import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import type { LogAdapter, ParsedSession, ParseError, RawEvent, Role } from '../../domain/types.ts';
import { stableEventId } from '../../shared/hash.ts';
import { fileMtimeIso, probeJsonl, readLines, summarizeText, toIso, walkFiles, contentBlocks } from './parse-utils.ts';
import { eventsFromBlock } from './qoder.ts';

const SESSION_PATH = /(session|chat|conversation|history|task|thread|transcript)/i;

export class GenericJsonlAdapter implements LogAdapter {
  id = 'generic' as const;

  discover(root: string): string[] {
    return walkFiles(root, (path) => path.endsWith('.jsonl') || (path.endsWith('.json') && SESSION_PATH.test(path)));
  }

  probe(path: string) {
    if (path.endsWith('.jsonl')) return probeJsonl(path, 'generic-jsonl');
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      const messages = messageList(data);
      return {
        format: 'generic-json-session',
        version: versionOf(data),
        ok: messages.length > 0,
        detail: messages.length ? undefined : 'no message array',
      };
    } catch (error) {
      return {
        format: 'generic-json-session',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  parse(path: string): ParsedSession[] {
    const fallback = fileMtimeIso(path);
    const errors: ParseError[] = [];
    let records: Record<string, unknown>[] = [];
    let root: Record<string, unknown> = {};

    if (path.endsWith('.json')) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
        if (Array.isArray(data)) {
          records = data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
        } else if (data && typeof data === 'object') {
          root = data as Record<string, unknown>;
          records = messageList(data);
        }
      } catch (error) {
        errors.push({ line: 0, message: error instanceof Error ? error.message : String(error) });
      }
    } else {
      const lines = readLines(path);
      for (let index = 0; index < lines.length; index += 1) {
        const raw = lines[index].trim();
        if (!raw) continue;
        try {
          records.push(JSON.parse(raw) as Record<string, unknown>);
        } catch (error) {
          errors.push({
            line: index + 1,
            message: error instanceof Error ? error.message : String(error),
            sample: raw.slice(0, 120),
          });
        }
      }
      root = records[0] ?? {};
    }

    let sessionId =
      firstString(root, ['sessionId', 'session_id', 'conversationId', 'threadId', 'id']) ??
      basename(path).replace(/\.jsonl?$/, '');
    let workspacePath = firstString(root, ['cwd', 'workspace', 'projectPath']);
    let startedAt: string | undefined;
    let endedAt: string | undefined;
    let title: string | undefined;
    let lastTime: string | undefined;
    const events: RawEvent[] = [];

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      sessionId = firstString(record, ['sessionId', 'session_id', 'conversationId', 'threadId']) ?? sessionId;
      workspacePath = firstString(record, ['cwd', 'workspace', 'projectPath']) ?? workspacePath;
      const occurredAt = toIso(record.timestamp ?? record.ts ?? record.time, lastTime ?? fallback);
      lastTime = occurredAt;
      if (!startedAt) startedAt = occurredAt;
      endedAt = occurredAt;

      const message = (record.message as Record<string, unknown> | undefined) ?? record;
      const role = (message.role ?? record.role ?? 'assistant') as Role;
      const blocks = contentBlocks(message.content ?? record.content);
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const produced = eventsFromBlock({
          block: blocks[blockIndex],
          sessionId,
          agent: 'generic',
          path,
          lineNo: index + 1,
          blockIndex,
          occurredAt,
          role,
          human: role === 'user',
          uuid: firstString(message, ['id', 'messageId', 'uuid']) ?? `generic-${index}`,
        });
        for (const event of produced) {
          events.push(event);
          if (!title && event.type === 'prompt' && event.text) title = summarizeText(event.text, 80);
        }
      }
      const toolCalls = record.toolCalls ?? record.tool_calls ?? message.toolCalls;
      if (Array.isArray(toolCalls)) {
        for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex += 1) {
          const call = toolCalls[toolIndex] as Record<string, unknown>;
          const tool = typeof call.name === 'string' ? call.name : 'tool';
          const callId = stableEventId([sessionId, index, toolIndex, 'tool_call', tool, JSON.stringify(call.args ?? {})]);
          events.push({
            id: callId,
            sessionId,
            type: 'tool_call',
            occurredAt,
            tool,
            input: call.args,
            provenance: { agent: 'generic', sourcePath: path, lineNo: index + 1, blockIndex: toolIndex, occurredAt },
          });
          if (call.result !== undefined) {
            events.push({
              id: stableEventId([callId, 'result']),
              sessionId,
              type: 'tool_result',
              occurredAt,
              role: 'tool',
              output: typeof call.result === 'string' ? call.result : JSON.stringify(call.result),
              success: true,
              provenance: { agent: 'generic', sourcePath: path, lineNo: index + 1, blockIndex: toolIndex, occurredAt },
            });
          }
        }
      }
    }

    return [
      {
        agent: 'generic',
        sessionId,
        workspacePath,
        startedAt: startedAt ?? fallback,
        endedAt,
        title,
        sourcePath: path,
        originKind: 'generic',
        events,
        errors,
      },
    ];
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function messageList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  for (const key of ['messages', 'chat', 'history', 'conversation', 'turns', 'items']) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
      );
    }
  }
  if (record.role && record.content) return [record];
  return [];
}

function versionOf(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  const value = record.version ?? record.schemaVersion ?? record.formatVersion;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}
