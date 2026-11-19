import { basename } from 'node:path';
import type { AgentKind, LogAdapter, ParsedSession, ParseError, RawEvent } from '../../domain/types.ts';
import { isEditTool } from '../../domain/rules.ts';
import { stableEventId } from '../../shared/hash.ts';
import { blockText, contentBlocks, fileMtimeIso, probeJsonl, readLines, summarizeText, toIso, walkFiles } from './parse-utils.ts';

interface CodexLine {
  timestamp?: unknown;
  type?: string;
  payload?: Record<string, unknown>;
}

export class CodexAdapter implements LogAdapter {
  id: AgentKind = 'codex';

  discover(root: string): string[] {
    return walkFiles(root, (path) => path.endsWith('.jsonl'));
  }

  probe(path: string) {
    return probeJsonl(path, 'codex-rollout');
  }

  parse(path: string): ParsedSession[] {
    const fallback = fileMtimeIso(path);
    const lines = readLines(path);
    let sessionId = basename(path, '.jsonl').replace(/^rollout-\d+-/, '');
    let workspacePath: string | undefined;
    let startedAt: string | undefined;
    let endedAt: string | undefined;
    let title: string | undefined;
    let lastTime: string | undefined;
    const events: RawEvent[] = [];
    const errors: ParseError[] = [];

    for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
      const raw = lines[lineNo].trim();
      if (!raw) continue;
      let line: CodexLine;
      try {
        line = JSON.parse(raw) as CodexLine;
      } catch (error) {
        errors.push({
          line: lineNo + 1,
          message: error instanceof Error ? error.message : String(error),
          sample: raw.slice(0, 120),
        });
        continue;
      }
      const payload = line.payload ?? {};
      if (line.type === 'session_meta') {
        if (typeof payload.id === 'string') sessionId = payload.id;
        if (typeof payload.cwd === 'string') workspacePath = payload.cwd;
      }
      if (line.type === 'turn_context' && typeof payload.cwd === 'string') workspacePath = payload.cwd;
      const occurredAt = toIso(line.timestamp ?? payload.timestamp, lastTime ?? fallback);
      lastTime = occurredAt;
      if (!startedAt) startedAt = occurredAt;
      endedAt = occurredAt;

      const payloadType = typeof payload.type === 'string' ? payload.type : '';
      if (line.type === 'response_item' && payloadType === 'message') {
        const role = payload.role === 'user' ? 'user' : 'assistant';
        const blocks = contentBlocks(payload.content);
        for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
          const text = blockText(blocks[blockIndex]);
          if (!text) continue;
          const type = role === 'user' ? 'prompt' : 'text';
          const event: RawEvent = {
            id: stableEventId([sessionId, lineNo, blockIndex, type, text]),
            sessionId,
            type,
            occurredAt,
            role,
            text,
            provenance: { agent: 'codex', sourcePath: path, lineNo: lineNo + 1, blockIndex, occurredAt },
          };
          events.push(event);
          if (!title && type === 'prompt') title = summarizeText(text, 80);
        }
      } else if (line.type === 'response_item' && payloadType === 'function_call') {
        const tool = typeof payload.name === 'string' ? payload.name : 'tool';
        let input: unknown = payload.arguments;
        if (typeof payload.arguments === 'string') {
          try {
            input = JSON.parse(payload.arguments);
          } catch {
            input = payload.arguments;
          }
        }
        const callId = stableEventId([sessionId, lineNo, 'tool_call', tool, JSON.stringify(input ?? {})]);
        events.push({
          id: callId,
          sessionId,
          type: 'tool_call',
          occurredAt,
          tool,
          input,
          provenance: { agent: 'codex', sourcePath: path, lineNo: lineNo + 1, blockIndex: 0, occurredAt },
        });
        if (isEditTool(tool)) {
          const record = input as Record<string, unknown> | undefined;
          events.push({
            id: stableEventId([callId, 'edit']),
            sessionId,
            type: 'edit',
            occurredAt,
            tool,
            input,
            filePath: typeof record?.file_path === 'string' ? record.file_path : undefined,
            provenance: { agent: 'codex', sourcePath: path, lineNo: lineNo + 1, blockIndex: 0, occurredAt },
          });
        }
      } else if (line.type === 'response_item' && payloadType === 'function_call_output') {
        const output = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '');
        events.push({
          id: stableEventId([sessionId, lineNo, 'tool_result', output]),
          sessionId,
          type: 'tool_result',
          occurredAt,
          role: 'tool',
          output,
          success: true,
          provenance: { agent: 'codex', sourcePath: path, lineNo: lineNo + 1, blockIndex: 0, occurredAt },
        });
      } else if (line.type === 'response_item' && payloadType === 'reasoning') {
        const text = String(payload.summary ?? payload.text ?? '');
        if (text) {
          events.push({
            id: stableEventId([sessionId, lineNo, 'thinking', text]),
            sessionId,
            type: 'thinking',
            occurredAt,
            role: 'assistant',
            text,
            provenance: { agent: 'codex', sourcePath: path, lineNo: lineNo + 1, blockIndex: 0, occurredAt },
          });
        }
      }
    }

    return [
      {
        agent: 'codex',
        sessionId,
        workspacePath,
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
}
