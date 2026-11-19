// ============================================================
// Telnet Terminal Adapter
// Implements CharDevice for a Telnet session, providing a
// Centurion CRT terminal that connects to the MUX/serial
// subsystem of the emulated Centurion.
//
// Incoming Telnet keystrokes are mapped to Centurion terminal
// codes; emulated output bytes are fed through the CenturionCRT
// screen-buffer emulator (src/terminal/crt.ts), which renders
// the CRT screen to ANSI escape sequences.
// ============================================================

import { TelnetSession } from '../telnet/server';
import { CharDevice } from '../../../shared/interfaces';
import {
    clearScreen, cursorHome, cursorShow,
} from '../telnet/ansi';
import { CenturionCRT } from '../terminal/crt';
import { sendTerminalInput, terminalKey } from '../terminal/input';

export class TelnetTerminal implements CharDevice {
    emu_linked = true;
    rts = true;

    private session: TelnetSession;
    private muxDev: CharDevice | undefined;
    private inputBuf: number[] = [];
    private inputInterval: NodeJS.Timeout | null = null;

    /** Screen-buffer emulation of the Centurion CRT. */
    private crt = new CenturionCRT();

    /** Set when receive() produced output that has not been flushed yet. */
    private outputDirty = false;

    name: string = 'TelnetTerm';

    constructor(session: TelnetSession) {
        this.session = session;

        // Override key handler
        session.onKey = (key: string, buf: string) => {
            this.handleInput(key);
        };

        session.onClose = () => {
            this.stop();
        };

        // When the OS asks the terminal for its status (ESC 0x05), send the
        // status message back into the MUX input stream.
        this.crt.onStatusMessage = (bytes: number[]) => {
            for (const b of bytes) this.inputBuf.push(b & 127);
            this.flushInput();
        };

        this.start();
        this.clearScreen();
    }

    private start(): void {
        this.inputInterval = setInterval(() => {
            this.flushInput();
            this.flushOutput();
        }, 20); // 50Hz input processing + screen flush
    }

    private stop(): void {
        if (this.inputInterval) {
            clearInterval(this.inputInterval);
            this.inputInterval = null;
        }
    }

    private handleInput(key: string): void {
        const code = terminalKey(key);
        if (code !== undefined) {
            this.inputBuf.push(code);
            this.flushInput();
        }
    }

    private muxConfigured = false; // True once ROM has written to MUX

    private flushInput(): void {
        // Don't send input until MUX is configured (ROM has booted far enough)
        if (!this.muxConfigured) return;
        sendTerminalInput(this.muxDev, this.inputBuf);
    }

    reset(): void {
        this.inputBuf.length = 0;
        this.muxConfigured = false;
        this.outputDirty = false;
        this.crt.reset();
        this.clearScreen();
    }

    // ---- CharDevice implementation ----

    receive(c: number): void {
        // First MUX output means ROM has configured the MUX
        this.muxConfigured = true;

        // Feed the byte through the CRT screen-buffer emulator; the diff is
        // rendered to the Telnet client on the next flush tick.
        this.crt.receive(c);
        this.outputDirty = true;
    }

    can_receive(): boolean {
        return this.session !== undefined;
    }

    check_send(): void {
        // Nothing buffered to send to emulated system
        // Input goes the other way (from telnet → emulator)
    }

    get_dev(): CharDevice | undefined {
        return this.muxDev;
    }

    bind_dev(dev: CharDevice | undefined): void {
        this.muxDev = dev;
        if (dev) {
            dev.set_cts(this.rts);
        }
    }

    set_cts(value: boolean): void {
        // CTS changed - not much to do for Telnet
    }

    // ---- Screen management ----

    private clearScreen(): void {
        this.session.write(clearScreen() + cursorHome() + cursorShow());
    }

    /**
     * Immediately render any pending CRT output to the Telnet client.
     * Normally called on the 20ms tick; exposed for tests.
     */
    flush(): void {
        this.flushOutput();
    }

    private flushOutput(): void {
        if (!this.outputDirty) return;
        this.outputDirty = false;
        const diff = this.crt.renderDiff();
        if (diff) this.session.write(diff);
    }

    // ---- Public access to input buffer for emulator polling ----

    get pendingInput(): number[] {
        return this.inputBuf;
    }

    readInput(): number {
        if (this.inputBuf.length > 0) {
            return this.inputBuf.shift()!;
        }
        return -1;
    }

    hasInput(): boolean {
        return this.inputBuf.length > 0;
    }

    /** Get pending input without removing */
    peekInput(): number | null {
        return this.inputBuf.length > 0 ? this.inputBuf[0] : null;
    }
}
