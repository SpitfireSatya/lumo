/* @flow */

import net from 'net';
import readline from 'readline';
import { createBanner } from './cli';
import { createSession, deleteSession, prompt, processLine } from './repl';
import { runAcceptFN } from './cljs';

let socketServer: ?net$Server = null;
const sockets: net$Socket[] = [];

let sessionCount = 0;
type AcceptFn = (socket: net$Socket) => void | string;

// Default socket accept function. This opens a repl and handles the readline and repl lifecycle
async function openRepl(socket: net$Socket): void {
  const rl = readline.createInterface({
    input: socket,
    output: socket,
  });

  const session = createSession(rl, false);

  socket.on('close', () => {
    deleteSession(session);
  });

  socket.on('error', () => {});

  rl.on('line', (line: string) => {
    // $FlowIssue: it's there
    if (!socket.destroyed) {
      processLine(session, line);
    }
  });

  rl.on('close', () => socket.destroy());

  rl.output.write(await createBanner());
  prompt(session, false, 'cljs.user');
}

// Calls the `accept` function on the socket and handles the socket lifecycle
async function handleConnection(
  socket: net$Socket,
  accept: AcceptFn,
  args: Array<mixed> = [],
): number {
  if (typeof accept === 'string') {
    await runAcceptFN(accept, socket, args);
  } else {
    await accept(socket);
  }

  // The index needs to be unique for the socket server, but not for anyone else.
  // For that reason we're using a module global `sessionCount` variable
  socket.on('close', () => {
    delete sockets[sessionCount];
  });

  sockets[sessionCount] = socket;

  sessionCount += 1;

  return sessionCount;
}

export function close(): void {
  if (socketServer != null) {
    sockets.forEach((socket: net$Socket) => {
      try {
        socket.destroy();
      } catch (e) {} // eslint-disable-line no-empty
    });

    socketServer.close();
  }
}

export async function open({
  port,
  host = 'localhost',
  accept = openRepl,
  args,
}: {
  port: number,
  host?: string,
  accept?: AcceptFn,
  args?: Array<mixed>,
}): Promise<mixed> {
  return new Promise(async (resolve: mixed => void, reject: Error => void) => {
    socketServer = await net.createServer(async (socket: net$Socket) =>
      await handleConnection(socket, accept, args),
    );

    // $FlowIssue - wrong type definitions for `listen`
    socketServer
      .listen(port, host, () => {
        resolve();
        process.on('SIGTERM', close);
        process.on('SIGHUP', close);
      })
      .on('error', reject);
  });
}
