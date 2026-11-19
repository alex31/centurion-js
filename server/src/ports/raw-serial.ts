// A single raw, seven-bit connection to the second MUX port. Unlike the
// Telnet terminal adapter this does not interpret control characters or
// render a screen; it is intended for a serial file-transfer bridge.
import * as net from 'net';

interface MuxPort {
    read_busy: boolean;
    _baud: number;
    _frame_cost: number;
    receive(byte: number): void;
}

// The mode-7 configuration targets approximately five million CPU6 steps per
// second. MUX frame cost is expressed in units of 50 per serial frame bit.
const CPU_STEPS_PER_SECOND = 5000000;
const MUX_FRAME_UNIT = 50;

export class RawSerialServer {
    private server: net.Server;
    private client: net.Socket | undefined;
    private input: number[] = [];
    private stepsUntilNextByte = 0;

    constructor(number: number, private port: MuxPort, private occupied: () => boolean) {
        this.server = net.createServer(socket => {
            if (this.client || this.occupied()) {
                socket.destroy();
                return;
            }
            this.client = socket;
            this.input = [];
            this.stepsUntilNextByte = 0;
            socket.setNoDelay(true);
            socket.on('data', data => {
                // The normal bridge sends at most one short CRT line at a time.
                if (this.input.length + data.length > 8192) {
                    socket.destroy();
                    return;
                }
                for (const byte of data) this.input.push(byte & 0x7f);
            });
            socket.on('error', error => console.error(`[RawSerial1] ${error.message}`));
            socket.on('close', () => {
                if (this.client !== socket) return;
                this.input = [];
                this.stepsUntilNextByte = 0;
                this.client = undefined;
                console.log('[RawSerial1] Connection closed');
            });
            console.log('[RawSerial1] Connected to MUX port 1');
        });
        this.server.on('error', error => console.error(`[RawSerial1] Server error: ${error.message}`));
        this.server.listen(number, process.env.CENTURION_BIND || '127.0.0.1', () => {
            const address = this.server.address();
            const port = address && typeof address !== 'string' ? address.port : number;
            console.log(`[RawSerial1] Raw serial server listening on port ${port}`);
        });
    }

    get connected(): boolean { return !!this.client; }

    get address(): net.AddressInfo | null {
        const address = this.server.address();
        return address && typeof address !== 'string' ? address : null;
    }

    /** Deliver input as the emulated CPU advances, at the configured baud. */
    advance(steps: number): void {
        if (!this.client) return;
        this.stepsUntilNextByte = Math.max(0, this.stepsUntilNextByte - steps);
        if (!this.input.length || this.stepsUntilNextByte || this.port.read_busy || this.port._baud <= 0) return;
        const frameBits = this.port._frame_cost / MUX_FRAME_UNIT;
        if (frameBits <= 0) return;
        this.port.receive(this.input.shift()!);
        this.stepsUntilNextByte = Math.ceil(CPU_STEPS_PER_SECOND * frameBits / this.port._baud);
    }

    write(byte: number): void {
        if (this.client && this.client.writable)
            this.client.write(Buffer.from([byte & 0x7f]));
    }

    close(): void {
        if (this.client) this.client.destroy();
        this.server.close();
    }
}
