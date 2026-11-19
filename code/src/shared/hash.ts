import { createHash } from 'node:crypto';

export function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

export function shortHash(input: string, length = 8): string {
  return sha1(input).slice(0, length);
}

export function stableEventId(parts: Array<string | number | undefined>): string {
  return sha1(parts.map((part) => String(part ?? '')).join('|'));
}
