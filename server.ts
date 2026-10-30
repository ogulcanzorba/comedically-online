import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { StreamHost } from './src/server/stream-host';
import { DEFAULT_PLAYBACK_DELAY_MS } from './src/lib/delay-buffer';
import { WS_PATH, type ClientRole } from './src/lib/ws-protocol';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);
const delayMs = Number(process.env.PLAYBACK_DELAY_MS ?? DEFAULT_PLAYBACK_DELAY_MS);

export async function startServer(listenPort: number = port): Promise<{ close: () => Promise<void> }> {
  const app = next({ dev });
  const handle = app.getRequestHandler();
  await app.prepare();

  const host = new StreamHost({ delayMs });
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname, query } = parse(req.url ?? '', true);
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    const role: ClientRole = query.role === 'publisher' ? 'publisher' : 'viewer';
    wss.handleUpgrade(req, socket, head, (ws) => {
      host.handleConnection(ws, role);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(listenPort, () => resolve());
  });
  console.log(`> Ready on http://localhost:${listenPort} (delay ${delayMs}ms)`);
  return {
    close: async () => {
      host.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

const invokedDirectly = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('/server.ts');
if (invokedDirectly) {
  void startServer();
}
