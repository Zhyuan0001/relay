#!/usr/bin/env node
import { resolve } from 'node:path';
import { createRelayServer } from './server.ts';

const port = Number(process.env.PORT ?? 4173);
const dbPath = resolve(process.env.RELAY_DB ?? '.relay/relay.db');
const { server, close } = createRelayServer({ dbPath });

server.listen(port, '127.0.0.1', () => {
  console.log(`Relay UI: http://127.0.0.1:${port}`);
});

const shutdown = async (): Promise<void> => {
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
