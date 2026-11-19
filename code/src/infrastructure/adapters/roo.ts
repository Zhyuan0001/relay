import { basename, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import type { AgentKind, LogAdapter, ParsedSession, ParseError, RawEvent, Role } from '../../domain/types.ts';
import { stableEventId } from '../../shared/hash.ts';
import { contentBlocks, fileMtimeIso, summarizeText, toIso, walkFiles } from './parse-utils.ts';
import { eventsFromBlock } from './qoder.ts';

interface RooMessage {
  role?: string;
  content?: unknown;
  ts?: unknown;
}

function parseRooLike(path: string, agent: AgentKind): ParsedSession[] {
    const fallback = fileMtimeIso(path);
    const sessionId = basename(dirname(path));
    let startedAt: string | undefined;
    let endedAt: string | undefined;
    let title: string | undefined;
    const events: RawEvent[] = [];
    const errors: ParseError[] = [];

    let messages: RooMessage[];
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      messages = Array.isArray(data) ? (data as RooMessage[]) : [];
    } catch (error) {
      return [
        {
          agent,
          sessionId,
          startedAt: fallback,
          sourcePath: path,
          originKind: 'real',
          events: [],
          errors: [{ line: 0, message: error instanceof Error ? error.message : String(error) }],
        },
      ];
    }

    let lastTime: string | undefined;
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const occurredAt = toIso(message.ts, lastTime ?? fallback);
      lastTime = occurredAt;
      if (!startedAt) startedAt = occurredAt;
      endedAt = occurredAt;
      const role = (message.role ?? 'assistant') as Role;
      const blocks = contentBlocks(message.content);
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const produced = eventsFromBlock({
          block: blocks[blockIndex],
          sessionId,
          agent,
          path,
          lineNo: index + 1,
          blockIndex,
          occurredAt,
          role,
          human: true,
          uuid: `msg-${index}`,
        });
        for (const event of produced) {
          events.push(event);
          if (!title && event.type === 'prompt' && event.text) title = summarizeText(event.text, 80);
        }
      }
    }

    return [
      {
        agent,
        sessionId,
        startedAt: startedAt ?? fallback,
        endedAt,
        title,
        sourcePath: path,
        originKind: 'real',
        events,
        errors,
      },
    ];
  }

export class RooCodeAdapter implements LogAdapter {
  id: AgentKind = 'roo-code';

  discover(root: string): string[] {
    return walkFiles(root, (path) => path.endsWith('api_conversation_history.json'));
  }

  parse(path: string): ParsedSession[] {
    return parseRooLike(path, 'roo-code');
  }

  probe(path: string) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (!Array.isArray(data)) return { format: 'roo-task-history', ok: false, detail: 'not a message array' };
      return { format: 'roo-task-history', ok: true };
    } catch (error) {
      return { format: 'roo-task-history', ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class ClineAdapter implements LogAdapter {
  id: AgentKind = 'cline';

  discover(root: string): string[] {
    return walkFiles(root, (path) => path.endsWith('api_conversation_history.json'));
  }

  parse(path: string): ParsedSession[] {
    return parseRooLike(path, 'cline');
  }

  probe(path: string) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (!Array.isArray(data)) return { format: 'roo-task-history', ok: false, detail: 'not a message array' };
      return { format: 'roo-task-history', ok: true };
    } catch (error) {
      return { format: 'roo-task-history', ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
