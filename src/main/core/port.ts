import net from 'node:net';
import { UserError } from './errors';

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

/** 从 preferred 起找第一个空闲端口。 */
export async function pickPort(preferred: number, hint: string): Promise<number> {
  for (let port = preferred; port < preferred + 20; port++) if (await isPortFree(port)) return port;
  throw new UserError(`端口 ${preferred} 附近都被占用`, hint);
}
