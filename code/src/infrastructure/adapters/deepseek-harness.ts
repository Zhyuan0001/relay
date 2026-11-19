import { basename, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import type { LogAdapter, ParsedSession, ParseError, RawEvent, Role } from '../../domain/types.ts';
import { stableEventId } from '../../shared/hash.ts';
import { fileMtimeIso, summarizeText, toIso, walkFiles, contentBlocks } from './parse-utils.ts';
import { eventsFromBlock } from './qoder.ts';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export function decompressFrames(input: Buffer): Buffer {
  const offsets: number[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const found = input.indexOf(ZSTD_MAGIC, cursor);
    if (found < 0) break;
    offsets.push(found);
    cursor = found + 4;
  }
  if (offsets.length <= 1) return zstdDecompressSync(input);
  const chunks = offsets.map((offset, index) =>
    zstdDecompressSync(input.subarray(offset, offsets[index + 1] ?? input.length)),
  );
  return Buffer.concat(chunks);
}

export class DeepSeekHarnessAdapter implements LogAdapter {
  id = 'deepseek-harness' as const;

  discover(root: string): string[] {
    return walkFiles(root, (path) => path.endsWith('.jsonl.zstd') || path.endsWith('.jsonl'));
  }


  probe(path: string) {
    try {
      const raw = readFileSync(path);
      const text = (path.endsWith('.zstd') ? decompressFrames(raw) : raw).toString('utf8');
      const first = text.split(/\r?\n/).find((line) => line.trim());
      if (!first) return { format: 'dsh-session-v4', ok: false, detail: 'empty session' };
      const object = JSON.parse(first) as Record<string, unknown>;
      const version = object.version;
      return {
        format: 'dsh-session-v4',
        version: typeof version === 'string' || typeof version === 'number' ? String(version) : undefined,
        ok: object.type === 'session' || Boolean(object.sessionId),
      };
    } catch (error) {
      return { format: 'dsh-session-v4', ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  parse(path: string): ParsedSession[] {
    const fallback = fileMtimeIso(path);
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith('.zstd') ? decompressFrames(raw) : raw).toString('utf8');
    } catch (error) {
      return [
        {
          agent: 'deepseek-harness',
          sessionId: basename(path).replace(/\.jsonl(\.zstd)?$/, ''),
          startedAt: fallback,
          sourcePath: path,
          originKind: 'real',
          events: [],
          errors: [{ line: 0, message: error instanceof Error ? error.message : String(error) }],
        },
      ];
    }

    let sessionId = basename(path).replace(/\.jsonl(\.zstd)?$/, '');
    if (sessionId === 'session.v4' || sessionId === 'session') sessionId = basename(dirname(path));
    let workspacePath: string | undefined;
    let sessionCreatedAt: string | undefined;
    let startedAt: string | undefined;
    let endedAt: string | undefined;
    let title: string | undefined;
    let lastTime: string | undefined;
    const events: RawEvent[] = [];
    const errors: ParseError[] = [];

    const lines = text.split(/\r?\n/);
    for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
      const rawLine = lines[lineNo].trim();
      if (!rawLine) continue;
      let line: Record<string, unknown>;
      try {
        line = JSON.parse(rawLine) as Record<string, unknown>;
      } catch (error) {
        errors.push({
          line: lineNo + 1,
          message: error instanceof Error ? error.message : String(error),
          sample: rawLine.slice(0, 120),
        });
        continue;
      }
      const payload = (line.payload as Record<string, unknown> | undefined) ?? {};
      const sid = line.sessionId ?? line.session_id ?? line.threadId ?? payload.sessionId;
      if (typeof sid === 'string' && sid) sessionId = sid;
      const cwd = line.cwd ?? line.workspace ?? payload.cwd;
      if (typeof cwd === 'string') workspacePath = cwd;
      const occurredAt = toIso(line.timestamp ?? line.ts ?? line.time ?? payload.timestamp, lastTime ?? fallback);
      lastTime = occurredAt;
      if (!startedAt) startedAt = occurredAt;
      endedAt = occurredAt;

      const nativeType = typeof line.type === 'string' ? line.type : '';
      if (nativeType === 'session') {
        if (typeof line.id === 'string') sessionId = line.id;
        if (typeof line.cwd === 'string') workspacePath = line.cwd;
        sessionCreatedAt = toIso(line.createdAt, occurredAt);
      }
      if (nativeType === 'session/title') {
        const data = (line.data as Record<string, unknown> | undefined) ?? {};
        if (typeof data.title === 'string' && data.title.trim()) title = data.title.trim();
      }
      if (nativeType === 'user/message' || nativeType === 'assistant/message') {
        const data = (line.data as Record<string, unknown> | undefined) ?? {};
        const message = nativeType === 'assistant/message'
          ? ((data.message as Record<string, unknown> | undefined) ?? {})
          : data;
        const role = nativeType === 'user/message' ? 'user' : 'assistant';
        const blocks = contentBlocks(message.content);
        for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
          const produced = eventsFromBlock({
            block: blocks[blockIndex],
            sessionId,
            agent: 'deepseek-harness',
            path,
            lineNo: lineNo + 1,
            blockIndex,
            occurredAt,
            role,
            human: role === 'user',
            uuid: typeof message.id === 'string' ? message.id : `dsh-${lineNo}`,
          });
          for (const event of produced) {
            events.push(event);
            if (!title && event.type === 'prompt' && event.text) title = summarizeText(event.text, 80);
          }
        }
        continue;
      }

      const payloadType = typeof payload.type === 'string' ? payload.type : '';
      if (payloadType === 'function_call') {
        const tool = typeof payload.name === 'string' ? payload.name : 'tool';
        let input: unknown = payload.arguments;
        if (typeof payload.arguments === 'string') {
          try {
            input = JSON.parse(payload.arguments);
          } catch {
            input = payload.arguments;
          }
        }
        events.push({
          id: stableEventId([sessionId, lineNo, 'tool_call', tool, JSON.stringify(input ?? {})]),
          sessionId,
          type: 'tool_call',
          occurredAt,
          tool,
          input,
          provenance: { agent: 'deepseek-harness', sourcePath: path, lineNo: lineNo + 1, blockIndex: 0, occurredAt },
        });
      } else if (payloadType === 'function_call_output') {
        const output = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '');
        events.push({
          id: stableEventId([sessionId, lineNo, 'tool_result', output]),
          sessionId,
          type: 'tool_result',
          occurredAt,
          role: 'tool',
          output,
          success: true,
          provenance: { agent: 'deepseek-harness', sourcePath: path, lineNo: lineNo + 1, blockIndex: 0, occurredAt },
        });
      } else {
        const message = (line.message as Record<string, unknown> | undefined) ?? line;
        const role = (message.role ?? line.role ?? 'assistant') as Role;
        const blocks = contentBlocks(message.content ?? line.content);
        for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
          const produced = eventsFromBlock({
            block: blocks[blockIndex],
            sessionId,
            agent: 'deepseek-harness',
            path,
            lineNo: lineNo + 1,
            blockIndex,
            occurredAt,
            role,
            human: role === 'user',
            uuid: `dsh-${lineNo}`,
          });
          for (const event of produced) {
            events.push(event);
            if (!title && event.type === 'prompt' && event.text) title = summarizeText(event.text, 80);
          }
        }
      }
    }

    return [
      {
        agent: 'deepseek-harness',
        sessionId,
        workspacePath,
        startedAt: startedAt ?? sessionCreatedAt ?? fallback,
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
