// ============================================================
// Telnet server - RFC 854 minimal implementation
// Handles TCP connections, Telnet IAC negotiation, and
// dispatches to port-specific session handlers.
// ============================================================

import * as net from 'net';
import { CSI, cursorHide, cursorShow, clearScreen, cursorHome, ansiReset } from './ansi';

// Telnet protocol constants
const IAC  = 255; // Interpret As Command
const WILL = 251;
const WONT = 252;
const DO   = 253;
const DONT = 254;
const SB   = 250;
const SE   = 240;

// Telnet options
const OPT_ECHO        = 1;
const OPT_SUPPRESS_GA = 3;
const OPT_TERMTYPE    = 24;
const OPT_NAWS        = 31; // Negotiate About Window Size
const OPT_LINEMODE    = 34;

export interface TelnetSession {
    socket: net.Socket;
    termType: string;
    cols: number;
    rows: number;
    write(data: string | Buffer): void;
    writeln(data: string): void;
    close(): void;
    onKey: (key: string, currentBuffer: string) => void;
    onClose?: () => void;
}

export type SessionFactory = (session: TelnetSession) => void;

class TelnetSessionImpl implements TelnetSession {
    socket: net.Socket;
    termType: string = 'unknown';
    cols: number = 80;
    rows: number = 24;
    private buffer: string = '';
    private state: 'data' | 'command' | 'option' | 'suboption' | 'subdata' | 'subcommand' = 'data';
    private command = 0;
    private suboption = 0;
    private subdata: number[] = [];
    private afterCR = false;

    constructor(socket: net.Socket) {
        this.socket = socket;
        this.socket.on('data', (data: Buffer) => this.handleData(data));
        this.socket.on('close', () => this.handleClose());
        this.socket.on('error', (err: Error) => {
            console.error(`Telnet session error: ${err.message}`);
        });
    }

    write(data: string | Buffer): void {
        if (!this.socket.writable) return;
        this.socket.write(data);
    }

    writeln(data: string): void {
        this.write(data + '\r\n');
    }

    close(): void {
        if (!this.socket.destroyed) {
            this.socket.end();
        }
    }

    private sendNegotiation(cmd: number, opt: number): void {
        const buf = Buffer.from([IAC, cmd, opt]);
        this.socket.write(buf);
    }

    private handleNegotiation(cmd: number, opt: number): void {
        // The greeting has already offered ECHO/SGA and requested TTYPE/NAWS.
        if (cmd === WILL) {
            if (opt === OPT_TERMTYPE)
                this.socket.write(Buffer.from([IAC, SB, opt, 1, IAC, SE]));
            else if (opt !== OPT_NAWS)
                this.sendNegotiation(opt === OPT_SUPPRESS_GA ? DO : DONT, opt);
        } else if (cmd === DO && opt !== OPT_ECHO && opt !== OPT_SUPPRESS_GA) {
            this.sendNegotiation(WONT, opt);
        }
    }

    private finishSubnegotiation(): void {
        const data = this.subdata;
        if (this.suboption === OPT_TERMTYPE && data[0] === 0) {
            this.termType = String.fromCharCode(...data.slice(1).filter(c => c >= 32 && c < 127)).toLowerCase();
        } else if (this.suboption === OPT_NAWS && data.length === 4) {
            this.cols = ((data[0] << 8) | data[1]) || this.cols;
            this.rows = ((data[2] << 8) | data[3]) || this.rows;
        }
    }

    private dataByte(b: number): void {
        const afterCR = this.afterCR;
        this.afterCR = b === 13;
        if (afterCR && (b === 10 || b === 0)) return;
        if (b === 127 || b === 8) this.handleKey('\x7f');
        else if (b >= 32 || b === 9 || b === 27 || b === 13 || b === 10 || b === 3 || b === 4 || b === 25)
            this.handleKey(String.fromCharCode(b));
    }

    private handleData(data: Buffer): void {
        for (const b of data) {
            switch (this.state) {
                case 'data':
                    if (b === IAC) this.state = 'command';
                    else this.dataByte(b);
                    break;
                case 'command':
                    this.state = 'data';
                    if (b === IAC) this.dataByte(b);
                    else if (b === SB) this.state = 'suboption';
                    else if (b >= WILL && b <= DONT) {
                        this.command = b;
                        this.state = 'option';
                    }
                    break;
                case 'option':
                    this.handleNegotiation(this.command, b);
                    this.state = 'data';
                    break;
                case 'suboption':
                    this.suboption = b;
                    this.subdata.length = 0;
                    this.state = 'subdata';
                    break;
                case 'subdata':
                    if (b === IAC) this.state = 'subcommand';
                    else if (this.subdata.length < 64) this.subdata.push(b);
                    break;
                case 'subcommand':
                    if (b === SE) {
                        this.finishSubnegotiation();
                        this.state = 'data';
                    } else {
                        if (b === IAC && this.subdata.length < 64) this.subdata.push(b);
                        this.state = 'subdata';
                    }
                    break;
            }
        }
    }

    private handleKey(key: string): void {
        this.onKey(key, this.buffer);
    }

    /** Override this in session handlers */
    onKey(key: string, currentBuffer: string): void {
        // Default: echo back and accumulate
        if (key === '\r') {
            this.writeln(this.buffer);
            this.buffer = '';
        } else if (key === '\x7f' || key === '\b') {
            if (this.buffer.length > 0) {
                this.buffer = this.buffer.slice(0, -1);
                this.write('\b \b');
            }
        } else {
            this.buffer += key;
            this.write(key);
        }
    }

    private handleClose(): void {
        // Will be overridden by close handler
    }

    get onClose(): (() => void) | undefined {
        return this._onClose;
    }

    set onClose(handler: (() => void) | undefined) {
        this._onClose = handler;
    }

    private _onClose?: () => void;
}

/**
 * Create a Telnet server on the given port.
 * Each connection gets a session created by the factory.
 */
export function createTelnetServer(
    port: number,
    factory: SessionFactory,
    label: string
): net.Server {
    const server = net.createServer((socket: net.Socket) => {
        const session = new TelnetSessionImpl(socket);

        console.log(`[${label}] Telnet connection from ${socket.remoteAddress}:${socket.remotePort}`);

        // Send initial welcome and initialize terminal
        session.write(clearScreen() + cursorHome() + cursorHide());

        // Negotiate echo (we'll echo locally, client shouldn't)
        session.write(Buffer.from([IAC, WILL, OPT_ECHO]));
        session.write(Buffer.from([IAC, WILL, OPT_SUPPRESS_GA]));

        // Request terminal type and window size
        session.write(Buffer.from([IAC, DO, OPT_TERMTYPE]));
        session.write(Buffer.from([IAC, DO, OPT_NAWS]));

        // Give the client a moment to negotiate, then start
        const negotiated = setTimeout(() => {
            factory(session);
        }, 100);

        socket.on('close', () => {
            clearTimeout(negotiated);
            console.log(`[${label}] Telnet session closed`);
            if (session.onClose) session.onClose();
        });

        socket.on('error', (err: Error) => {
            console.error(`[${label}] Socket error: ${err.message}`);
        });
    });

    server.listen(port, process.env.CENTURION_BIND || '127.0.0.1', () => {
        console.log(`[${label}] Telnet server listening on port ${port}`);
    });

    server.on('error', (err: Error) => {
        console.error(`[${label}] Server error: ${err.message}`);
    });

    return server;
}
