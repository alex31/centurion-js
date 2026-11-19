import { CharDevice } from '../../../shared/interfaces';

export type TerminalPort = CharDevice & {read_busy?: boolean};

/** Encode Telnet and browser key sequences for the Centurion CRT. */
export function terminalKey(key: string): number | undefined {
    switch (key) {
        case '\r': case '\n': return 13;
        case '\x7f': return 8;
        case '\x1b[A': case '\x1bOA': return 26;
        case '\x1b[B': case '\x1bOB': return 10;
        case '\x1b[C': case '\x1bOC': return 6;
        case '\x1b[D': case '\x1bOD': return 21;
        default: return key.length === 1 ? key.charCodeAt(0) & 127 : undefined;
    }
}

export function sendTerminalInput(port: TerminalPort | undefined, queue: number[]): void {
    if (port && queue.length && !port.read_busy && (port.rts !== false || queue[0] === 3)) {
        port.receive(queue.shift()!);
    }
}
