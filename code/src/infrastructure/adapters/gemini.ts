import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import type { LogAdapter, ParsedSession, ParseError, RawEvent } from '../../domain/types.ts';
import { stableEventId } from '../../shared/hash.ts';
import { fileMtimeIso, summarizeText, toIso, walkFiles } from './parse-utils.ts';

interface GeminiMessage {
  type?: string;
  content?: unknown;
  timestamp?: unknown;
  toolCalls?: Array<{ name?: string; args?: unknown; result?: unknown }>;
}

interface GeminiSession {
  sessionId?: string;
  startTime?: unknown;
  workspace?: string;
  cwd?: string;
  messages?: GeminiMessage[];
}

export class GeminiAdapter implements LogAdapter {
  id = 'gemini' as const;

  discover(root: string): string[] {
    return walkFiles(root, (path) => /(^|\/)session-[^/]*\.json$/.test(path));
  }


  probe(path: string) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as GeminiSession;
      return {
        format: 'gemini-session-json',
        version: typeof (data as Record<string, unknown>).version === 'string' ? String((data as Record<string, unknown>).version) : undefined,
        ok: Array.isArray(data.messages),
      };
    } catch (error) {
      return { format: 'gemini-session-json', ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  parse(path: string): ParsedSession[] {
    const fallback = fileMtimeIso(path);
    let data: GeminiSession;
    try {
      data = JSON.parse(readFileSync(path, 'utf8')) as GeminiSession;
    } catch (error) {
      return [
        {
          agent: 'gemini',
          sessionId: basename(path, '.json'),
          startedAt: fallback,
          sourcePath: path,
          originKind: 'real',
          events: [],
          errors: [{ line: 0, message: error instanceof Error ? error.message : String(error) }],
        },
      ];
    }
    const sessionId = data.sessionId ?? basename(path, '.json');
    const events: RawEvent[] = [];
    const errors: ParseError[] = [];
    let startedAt: string | undefined;
    let endedAt: string | undefined;
    let title: string | undefined;
    let lastTime: string | undefined;

    for (let index = 0; index < (data.messages ?? []).length; index += 1) {
      const message = data.messages![index];
      const occurredAt = toIso(message.timestamp, lastTime ?? fallback);
      lastTime = occurredAt;
      if (!startedAt) startedAt = occurredAt;
      endedAt = occurredAt;
      const role = message.type === 'user' ? 'user' : 'assistant';
      const text = typeof message.content === 'string' ? message.content : undefined;
      if (text) {
        const type = role === 'user' ? 'prompt' : 'text';
        events.push({
          id: stableEventId([sessionId, index, type, text]),
          sessionId,
          type,
          occurredAt,
          role,
          text,
          provenance: { agent: 'gemini', sourcePath: path, lineNo: index + 1, blockIndex: 0, occurredAt },
        });
        if (!title && type === 'prompt') title = summarizeText(text, 80);
      }
      for (let toolIndex = 0; toolIndex < (message.toolCalls ?? []).length; toolIndex += 1) {
        const call = message.toolCalls![toolIndex];
        const tool = call.name ?? 'tool';
        const callId = stableEventId([sessionId, index, toolIndex, 'tool_call', tool, JSON.stringify(call.args ?? {})]);
        events.push({
          id: callId,
          sessionId,
          type: 'tool_call',
          occurredAt,
          tool,
          input: call.args,
          provenance: { agent: 'gemini', sourcePath: path, lineNo: index + 1, blockIndex: toolIndex, occurredAt },
        });
        if (call.result !== undefined) {
          const output = typeof call.result === 'string' ? call.result : JSON.stringify(call.result);
          events.push({
            id: stableEventId([callId, 'result']),
            sessionId,
            type: 'tool_result',
            occurredAt,
            role: 'tool',
            output,
            success: true,
            provenance: { agent: 'gemini', sourcePath: path, lineNo: index + 1, blockIndex: toolIndex, occurredAt },
          });
        }
      }
    }

    return [
      {
        agent: 'gemini',
        sessionId,
        workspacePath: data.workspace ?? data.cwd,
        startedAt: startedAt ?? toIso(data.startTime, fallback),
        endedAt,
        title,
        sourcePath: path,
        originKind: 'real',
        events,
        errors,
      },
    ];
  }
}
