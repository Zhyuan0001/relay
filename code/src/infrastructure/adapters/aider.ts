import { basename, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import type { LogAdapter, ParsedSession, RawEvent } from '../../domain/types.ts';
import { stableEventId } from '../../shared/hash.ts';
import { fileMtimeIso, readLines, summarizeText, toIso, walkFiles } from './parse-utils.ts';

export class AiderAdapter implements LogAdapter {
  id = 'aider' as const;

  discover(root: string): string[] {
    return walkFiles(root, (path) => path.endsWith('.aider.chat.history.md'));
  }


  probe(path: string) {
    try {
      const text = readFileSync(path, 'utf8');
      const ok = text.includes('# aider chat started') || text.includes('\n#### ');
      return { format: 'aider-markdown', ok };
    } catch (error) {
      return { format: 'aider-markdown', ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  parse(path: string): ParsedSession[] {
    const lines = readLines(path);
    const fallback = fileMtimeIso(path);
    const workspacePath = dirname(path);
    const sessionId = `aider-${basename(workspacePath)}`;
    let startedAt = fallback;
    for (const line of lines) {
      const match = line.match(/^# aider chat started at (.+)$/);
      if (match) {
        startedAt = toIso(match[1], fallback);
        break;
      }
    }

    const events: RawEvent[] = [];
    let title: string | undefined;
    let currentUser: string | null = null;
    let assistant: string[] = [];
    let blockIndex = 0;

    const flush = (): void => {
      if (currentUser === null && !assistant.length) return;
      const occurredAt = toIso(new Date(Date.parse(startedAt) + blockIndex * 1000), startedAt);
      if (currentUser) {
        events.push({
          id: stableEventId([sessionId, blockIndex, 'prompt', currentUser]),
          sessionId,
          type: 'prompt',
          occurredAt,
          role: 'user',
          text: currentUser,
          provenance: { agent: 'aider', sourcePath: path, lineNo: blockIndex + 1, blockIndex, occurredAt },
        });
        if (!title) title = summarizeText(currentUser, 80);
      }
      const text = assistant.join('\n').trim();
      if (text) {
        events.push({
          id: stableEventId([sessionId, blockIndex, 'text', text]),
          sessionId,
          type: 'text',
          occurredAt,
          role: 'assistant',
          text,
          provenance: { agent: 'aider', sourcePath: path, lineNo: blockIndex + 1, blockIndex, occurredAt },
        });
      }
      currentUser = null;
      assistant = [];
      blockIndex += 1;
    };

    for (const line of lines) {
      if (line.startsWith('#### ')) {
        flush();
        currentUser = line.slice(5).trim();
      } else if (currentUser !== null && !line.startsWith('# ')) {
        assistant.push(line);
      }
    }
    flush();

    return [
      {
        agent: 'aider',
        sessionId,
        workspacePath,
        startedAt,
        endedAt: events.length ? events[events.length - 1].occurredAt : fallback,
        title,
        sourcePath: path,
        originKind: 'real',
        events,
        errors: [],
      },
    ];
  }
}
