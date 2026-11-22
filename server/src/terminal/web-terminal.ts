import { CenturionCRT, CRT_COLS } from './crt';
import { sendTerminalInput, terminalKey, TerminalPort } from './input';

const BOOT_TIMEOUT_MS = 45_000;
const QUEUE_LIMIT = 4096;

interface BootStep {
    prompt: string;
    input: string;
    status: string;
}

interface BootClock {
    date: string;
    time: string;
}

export function bootClock(date: unknown, time: unknown): BootClock {
    if (typeof date !== 'string' || typeof time !== 'string' ||
        !/^\d{6}$/.test(date) || !/^\d{6}$/.test(time)) {
        throw new Error('Invalid boot date or time');
    }
    return {date, time};
}

export class WebTerminal {
    private crt = new CenturionCRT();
    private input: number[] = [];
    private output = '';
    private steps: BootStep[] = [];
    private deadline = 0;
    private bootStatus = '';

    constructor(private port: TerminalPort, private available: () => boolean) {
        this.crt.onStatusMessage = bytes => {
            if (this.available() && this.input.length + bytes.length <= QUEUE_LIMIT) {
                this.enqueue(bytes);
            }
        };
    }

    private enqueue(bytes: number[]): void {
        if (bytes.length + this.input.length > QUEUE_LIMIT) throw new Error('Terminal input is full');
        this.input.push(...bytes);
    }

    receive(code: number): void {
        this.crt.receive(code);
        this.output = (this.output + String.fromCharCode(code & 127)).slice(-120);
        if (this.steps.length && /(?:^|[\r\n\f])ERROR$/.test(this.output)) {
            this.steps = [];
            this.input.length = 0;
            this.bootStatus = 'Boot failed: check the CENTOS image in DSK2 unit 1';
            return;
        }
        this.advanceBoot();
    }

    private atBootPrompt(): boolean {
        const start = this.crt.cursorY * CRT_COLS;
        const prefix = this.crt.buffer.subarray(start, start + this.crt.cursorX);
        const text = String.fromCharCode(...prefix.map(cell => cell & 127)).trimEnd();
        return /(?:^|\s)D=$/.test(text);
    }

    private advanceBoot(): void {
        const step = this.steps[0];
        if (!step) return;
        const matched = step.prompt === 'D=' ? this.atBootPrompt() : this.output.endsWith(step.prompt);
        if (!matched) return;
        this.steps.shift();
        this.bootStatus = step.status;
        this.deadline = Date.now() + BOOT_TIMEOUT_MS;
        if (step.input) this.enqueue(Array.from(step.input, ch => ch.charCodeAt(0)));
    }

    tick(): void {
        if (!this.available()) {
            if (this.steps.length) this.bootStatus = 'Boot cancelled: raw serial in use';
            this.steps = [];
            this.input.length = 0;
            return;
        }
        if (this.steps.length && Date.now() > this.deadline) {
            this.steps = [];
            this.input.length = 0;
            this.bootStatus = 'Boot timed out waiting for the next prompt';
        }
        sendTerminalInput(this.port, this.input);
    }

    reset(): void {
        this.crt.reset();
        this.input.length = 0;
        this.output = '';
        this.steps = [];
        this.bootStatus = '';
    }

    key(key: string): void {
        if (!this.available()) throw new Error('CRT1 is reserved for raw serial');
        if (!this.output) throw new Error('The terminal is waiting for output from the CPU');
        if (!this.steps.length && this.crt.applicationCursorKeys && /^\x1b\[[56]~$/.test(key)) {
            this.enqueue(Array.from(key, ch => ch.charCodeAt(0)));
            return;
        }
        const code = terminalKey(key);
        if (code === undefined || (key.length === 1 && key.charCodeAt(0) > 127)) return;
        if (this.steps.length) {
            if (code !== 3) return;
            this.steps = [];
            this.input.length = 0;
            this.bootStatus = 'Boot cancelled';
        }
        if (this.crt.applicationCursorKeys && /^\x1b(?:\[|O)[A-D]$/.test(key)) {
            this.enqueue([27, 79, key.charCodeAt(2)]); // ESC O + arrow
        } else {
            this.enqueue([code]);
        }
    }

    paste(text: string): void {
        if (!this.available() || !this.output || this.steps.length) return;
        const ascii = text.replace(/\r\n|\n/g, '\r').replace(/[^\x09\x0d\x20-\x7e]/g, '');
        this.enqueue(Array.from(ascii, ch => ch.charCodeAt(0)));
    }

    get bootReady(): boolean {
        return this.available() && this.atBootPrompt() &&
            !this.steps.length && !this.input.length;
    }

    boot({date, time}: BootClock, waitForPrompt = false): void {
        if (!waitForPrompt && !this.bootReady) throw new Error('Wait for the ROM D= prompt');
        this.steps = [
            {prompt: 'D=', input: 'H1', status: 'Waiting for the system disk prompt'},
            {prompt: 'SYSTEM DISK (S)= 1', input: '\r', status: 'Waiting for the date prompt'},
            {prompt: 'ENTER NEW SYSTEM DATE', input: date + '\r', status: 'Waiting for the time prompt'},
            {prompt: 'ENTER SYSTEM TIME', input: time + '\r', status: 'Waiting for CENTOS'},
            {prompt: 'CRT0 READY', input: '', status: 'CENTOS is ready'},
        ];
        this.bootStatus = 'Waiting for the ROM D= prompt';
        this.deadline = Date.now() + BOOT_TIMEOUT_MS;
        this.advanceBoot();
    }

    snapshot() {
        return {
            cells: Array.from(this.crt.buffer),
            x: this.crt.cursorX,
            y: this.crt.cursorY,
            available: this.available(),
            bootReady: this.bootReady,
            bootStatus: this.bootStatus,
        };
    }
}
