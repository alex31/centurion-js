import { readFileSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { Duplex } from 'node:stream';
import { URL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { CoreEmulator, HAWK_STRIDES } from './core/emulator';
import { bootClock, WebTerminal } from './terminal/web-terminal';

interface ConsoleActions {
    reset(): void;
    update(): void;
    shutdown(): void;
}

const ASSETS = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/console.css', ['console.css', 'text/css; charset=utf-8']],
    ['/console.js', ['console.js', 'text/javascript; charset=utf-8']],
]);

function reply(res: ServerResponse, status: number, text: string): void {
    res.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end(text);
}

export class WebConsole {
    readonly http = createServer({requestTimeout: 30_000}, (req, res) => {
        this.request(req, res).catch(error => {
            if (!res.headersSent) reply(res, 500, 'Console request failed');
            else res.end();
            console.error('[Web console]', error.message);
        });
    });
    private sockets = new WebSocketServer({noServer: true, maxPayload: 32768});
    private hosts = new Set(['127.0.0.1', 'localhost', '::1']);
    private assets: Map<string, {type: string; data: Buffer}>;

    constructor(private emulator: CoreEmulator, private terminals: (WebTerminal | null)[],
                private actions: ConsoleActions, bind: string,
                webRoot = resolve(__dirname, '../../web')) {
        this.assets = new Map([...ASSETS].map(([route, [file, type]]) => [
            route, {type, data: readFileSync(join(webRoot, file))},
        ]));
        this.hosts.add(bind);
        if (bind === '0.0.0.0' || bind === '::') {
            for (const entries of Object.values(networkInterfaces())) {
                for (const entry of entries ?? []) this.hosts.add(entry.address);
            }
        }
        this.sockets.on('connection', socket => {
            socket.on('error', error => console.error('[Web console]', error.message));
            socket.on('message', data => this.message(socket, data.toString()));
            socket.send(this.snapshot());
        });
    }

    get connected(): boolean {
        return this.sockets.clients.size > 0;
    }

    private trustedHost(req: IncomingMessage): boolean {
        const host = req.headers.host;
        if (!host || !/^[a-zA-Z0-9.:[\]-]+$/.test(host)) return false;
        try {
            const name = new URL('http://' + host).hostname.replace(/^\[|\]$/g, '');
            return this.hosts.has(name);
        } catch {
            return false;
        }
    }

    private sameOrigin(req: IncomingMessage): boolean {
        // The dashboard uses plain HTTP on the configured local server.
        return this.trustedHost(req) && req.headers.origin === 'http://' + req.headers.host;
    }

    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
        if (!this.sameOrigin(req)) {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            return;
        }
        this.sockets.handleUpgrade(req, socket, head, ws => this.sockets.emit('connection', ws));
    }

    private snapshot(): string {
        const cpu = this.emulator.cpu;
        const regs = cpu.regfile;
        const start = cpu.level * 16;
        const registers = Array.from({length: 8}, (_, i) =>
            ((regs[start + i * 2] || 0) << 8) | (regs[start + i * 2 + 1] || 0));
        return JSON.stringify({
            type: 'state',
            running: this.emulator.isRunning,
            rate: this.emulator.runRate,
            speed: this.emulator.runSpeed,
            pc: cpu.pc, level: cpu.level, map: cpu.map, cc: cpu.cc, registers,
            disks: this.emulator.getAllDiskUnits().map(({label, image}) => ({
                label,
                filename: image?.filename ?? null,
                stride: image?.stride ?? null,
            })),
            canSave: !!this.emulator.getHawkImage(),
            terminals: this.terminals.map(terminal => terminal?.snapshot() ?? null),
        });
    }

    broadcast(): void {
        if (!this.connected) return;
        const state = this.snapshot();
        for (const socket of this.sockets.clients) {
            if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256 * 1024) {
                socket.send(state);
            }
        }
    }

    private message(socket: WebSocket, raw: string): void {
        try {
            const message = JSON.parse(raw);
            const channel = message.port;
            const terminal = (channel === 0 || channel === 1) ? this.terminals[channel] : null;
            if (!terminal) throw new Error('Unknown terminal');
            if (message.type === 'key' && typeof message.key === 'string') {
                terminal.key(message.key);
            } else if (message.type === 'paste' && typeof message.text === 'string') {
                terminal.paste(message.text);
            } else if (message.type === 'boot') {
                if (!this.emulator.getHawkImage()) throw new Error('Load a CENTOS disk image first');
                terminal.boot(bootClock(message.date, message.time));
                this.emulator.start();
                this.actions.update();
            } else {
                throw new Error('Unknown terminal command');
            }
        } catch (error) {
            socket.send(JSON.stringify({type: 'error', message: error.message}));
        }
    }

    private async request(req: IncomingMessage, res: ServerResponse): Promise<void> {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!this.trustedHost(req)) {
            reply(res, 403, 'Invalid Host');
            return;
        }
        const url = new URL(req.url ?? '/', 'http://localhost');
        const route = url.pathname;
        const asset = this.assets.get(route);
        if (asset && req.method === 'GET') {
            const source = 'ws://' + req.headers.host;
            res.setHeader('Content-Security-Policy',
                "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; connect-src 'self' " + source);
            res.writeHead(200, {'Content-Type': asset.type});
            res.end(asset.data);
            return;
        }
        if (req.method === 'POST' && route.startsWith('/api/') && !this.sameOrigin(req)) {
            req.resume();
            reply(res, 403, 'Use the local console page to control the server');
            return;
        }
        if (route === '/api/disk') {
            if (req.method === 'POST') {
                await this.upload(req, res, url);
                return;
            }
            if (req.method === 'GET') {
                this.download(req, res);
                return;
            }
        }
        if (route === '/api/control' && req.method === 'POST') {
            req.resume();
            this.control(res, url.searchParams.get('action'), url.searchParams.get('mode'));
            return;
        }
        reply(res, 404, 'Not found');
    }

    private async upload(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
        const length = Number(req.headers['content-length']);
        if (!HAWK_STRIDES.has(length)) {
            req.resume();
            reply(res, 400, 'Select a 5,196,800 or 6,651,904 byte Hawk image');
            return;
        }
        const bootPort = url.searchParams.get('boot');
        let boot: {terminal: WebTerminal; clock: ReturnType<typeof bootClock>} | undefined;
        if (bootPort !== null) {
            const terminal = (bootPort === '0' || bootPort === '1') ? this.terminals[Number(bootPort)] : null;
            if (!terminal) {
                req.resume();
                reply(res, 400, 'Unknown boot terminal');
                return;
            }
            try {
                boot = {terminal, clock: bootClock(url.searchParams.get('date'), url.searchParams.get('time'))};
            } catch (error) {
                req.resume();
                reply(res, 400, error.message);
                return;
            }
        }
        const data = Buffer.alloc(length);
        let at = 0;
        for await (const chunk of req) {
            if (at + chunk.length > length) throw new Error('Hawk upload exceeds the declared size');
            chunk.copy(data, at);
            at += chunk.length;
        }
        if (at !== length) {
            reply(res, 400, 'Incomplete image');
            return;
        }
        const filename = url.searchParams.get('name')?.split(/[\\/]/).pop()?.slice(0, 128) || 'uploaded.img';
        this.emulator.mountHawkImage(filename, data);
        this.actions.reset();
        if (boot) {
            boot.terminal.boot(boot.clock, true);
            this.emulator.start();
        }
        this.actions.update();
        reply(res, 200, boot ? 'Image mounted on DSK2 unit 1. Starting CENTOS…' :
            'Image mounted on DSK2 unit 1');
    }

    private download(req: IncomingMessage, res: ServerResponse): void {
        if (req.headers['sec-fetch-site'] === 'cross-site') {
            reply(res, 403, 'Open the local console to save the image');
            return;
        }
        const image = this.emulator.getHawkImage();
        if (!image) {
            reply(res, 404, 'No Hawk image mounted on DSK2 unit 1');
            return;
        }
        const data = Buffer.from(image.data);
        const stem = image.filename.replace(/\.img$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'hawk';
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${stem}-snapshot.img"`,
            'Content-Length': data.length,
        });
        res.end(data);
    }

    private control(res: ServerResponse, action: string | null, mode: string | null): void {
        switch (action) {
            case 'run': this.emulator.start(); break;
            case 'pause': this.emulator.stop(); break;
            case 'speed':
                if (mode !== 'realtime' && mode !== 'maximum') {
                    reply(res, 400, 'Unknown speed mode');
                    return;
                }
                this.emulator.setRunSpeed(mode);
                break;
            case 'step':
                if (this.emulator.isRunning) {
                    reply(res, 409, 'Pause the CPU before stepping');
                    return;
                }
                this.emulator.step(true);
                break;
            case 'reset': this.actions.reset(); break;
            case 'shutdown':
                res.setHeader('Connection', 'close');
                res.once('finish', () => this.actions.shutdown());
                reply(res, 200, 'Server stopped');
                return;
            default:
                reply(res, 400, 'Unknown control command');
                return;
        }
        this.actions.update();
        reply(res, 200, 'OK');
    }
}
