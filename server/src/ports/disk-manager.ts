// ============================================================
// Disk Management Telnet Port
// Menu-driven interface for loading, creating, exporting,
// and inspecting disk images (Hawk and Finch).
// ============================================================

import { HAWK_STRIDES } from '../core/emulator';
import { TelnetSession } from '../telnet/server';
import {
    DiskImage, DiskContainer, DiskType,
    FINCH_TRACK, FINCH_PLAT,
} from '../../../shared/interfaces';
import {
    Color, fg, bg, ansiReset, bold, dim, reverse,
    cursorPos, cursorHome, clearScreen, cursorHide, cursorShow,
    hLine,
} from '../telnet/ansi';
import * as fs from 'fs';
import * as path from 'path';

export interface ManagedDisk {
    container: DiskContainer & {image: DiskImage | null};
    label: string;
    type: 'dsk2' | 'finch';
    unitIndex: number;
}

export class DiskManagerSession {
    private session: TelnetSession;
    private disks: ManagedDisk[] = [];
    private diskDir: string;
    private ejecting = false;
    private files: string[] = [];

    constructor(disks: ManagedDisk[], session: TelnetSession, diskDir: string = './disks') {
        this.disks = disks;
        this.session = session;
        this.diskDir = diskDir;

        // Ensure disks directory exists
        if (!fs.existsSync(diskDir)) {
            fs.mkdirSync(diskDir, { recursive: true });
        }

        session.onKey = (key: string, buf: string) => {
            // Simple menu navigation via single keystrokes
            this.handleKey(key);
        };

        session.onClose = () => {};

        this.showMenu();
    }

    private handleKey(key: string): void {
        if (/^[0-7]$/.test(key)) {
            if (this.ejecting) {
                const disk = this.disks[Number(key)];
                if (disk?.container.image) disk.container.set_disk(null);
                this.showMenu();
            } else this.mountExisting(Number(key));
            return;
        }
        this.ejecting = false;
        switch (key.toLowerCase()) {
            case 'l': this.showLoadMenu(); break;
            case 'n': this.showNewDiskMenu(); break;
            case 'e': this.session.writeln('Use Save image in the web console to download Hawk unit 1.'); break;
            case 'u': this.showUnmountMenu(); break;
            case 'i': this.showDiskInfo(); break;
            case 'm': this.showMenu(); break;
            case 'q':
                this.session.writeln(fg(Color.BRIGHT_YELLOW) + 'Disconnecting disk manager...' + ansiReset());
                this.session.close();
                break;
            default:
                break;
        }
    }

    private showMenu(): void {
        this.ejecting = false;
        this.files = [];
        let out = '';
        out += clearScreen() + cursorHome() + cursorHide();

        // Title
        out += fg(Color.BRIGHT_WHITE) + bg(Color.BLUE) + bold();
        out += '  CENTURION CPU-6  │  Disk Management  │  [M]enu [L]oad [N] Formats [E] Save help [I]nfo [Q]uit  ';
        out += ansiReset() + '\r\n\r\n';

        // Disk status overview
        out += fg(Color.BRIGHT_WHITE) + bold() + '  MOUNTED DISKS' + ansiReset() + '\r\n';
        out += hLine(3, 2, 76) + '\r\n';

        for (let i = 0; i < this.disks.length; i++) {
            const d = this.disks[i];
            out += cursorPos(4 + i, 2);
            const num = `[${i}]`;
            out += bold() + fg(Color.BRIGHT_CYAN) + num + ansiReset() + ' ';

            if (d.container.image) {
                const sizeMB = (d.container.image.backing_data.byteLength / (1024 * 1024)).toFixed(1);
                const typeStr = d.container.image.type.toUpperCase();
                const protStr = d.container.image.protect ? fg(Color.RED) + 'WP' + ansiReset() : fg(Color.GREEN) + 'RW' + ansiReset();
                out += fg(Color.BRIGHT_GREEN) + d.container.image.filename.padEnd(30) + ansiReset();
                out += fg(Color.BRIGHT_BLACK) + ` ${typeStr.padEnd(6)} ${sizeMB.padStart(8)}MB  ${protStr}` + ansiReset();
            } else {
                out += dim() + fg(Color.BRIGHT_BLACK) +
                    `(empty - ${d.label})`.padEnd(40) +
                    `${d.type.toUpperCase().padEnd(6)}` + ansiReset();
            }
        }
        out += '\r\n\r\n';

        // Commands
        out += fg(Color.BRIGHT_WHITE) + bold() + '  COMMANDS' + ansiReset() + '\r\n';
        out += fg(Color.BRIGHT_CYAN) + '  [L]' + ansiReset() + ' Load disk image into a drive\r\n';
        out += fg(Color.BRIGHT_CYAN) + '  [N]' + ansiReset() + ' List supported blank disk formats\r\n';
        out += fg(Color.BRIGHT_CYAN) + '  [E]' + ansiReset() + ' Show how to save Hawk unit 1\r\n';
        out += fg(Color.BRIGHT_CYAN) + '  [I]' + ansiReset() + ' Show detailed disk information\r\n';
        out += fg(Color.BRIGHT_CYAN) + '  [0-7]' + ansiReset() + ' Quick-mount from disks/ directory\r\n';
        out += fg(Color.BRIGHT_CYAN) + '  [U]' + ansiReset() + ' Unmount (eject) a disk\r\n';

        this.session.write(out);
    }

    private listFiles(): string[] {
        return fs.readdirSync(this.diskDir, {withFileTypes: true})
            .filter(file => file.isFile() && /\.(img|ffi)$/i.test(file.name))
            .map(file => file.name).sort().slice(0, 8);
    }

    private showLoadMenu(): void {
        let out = clearScreen() + cursorHome();
        out += fg(Color.BRIGHT_WHITE) + bg(Color.BLUE) + bold();
        out += '  LOAD DISK IMAGE  │  Select drive and file  ';
        out += ansiReset() + '\r\n\r\n';

        // List available disk files
        out += fg(Color.BRIGHT_WHITE) + '  Available disk images in ' + this.diskDir + ':' + ansiReset() + '\r\n';

        try {
            const files = this.files = this.listFiles();

            if (files.length === 0) {
                out += dim() + '  (no disk images found)' + ansiReset() + '\r\n';
            } else {
                for (let i = 0; i < files.length; i++) {
                    const f = files[i];
                    const stats = fs.statSync(path.join(this.diskDir, f));
                    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
                    const num = i.toString().padStart(2);
                    out += fg(Color.BRIGHT_CYAN) + `  [${num}]` + ansiReset();
                    out += ` ${f.padEnd(35)} ${sizeMB.padStart(8)}MB\r\n`;
                }
            }
        } catch {
            out += fg(Color.RED) + '  Error reading disk directory' + ansiReset() + '\r\n';
        }

        out += '\r\n' + fg(Color.BRIGHT_BLACK) + '  [M] Back to menu' + ansiReset();

        this.session.write(out);
    }

    private mountExisting(index: number): void {
        try {
            const files = this.files.length ? this.files : this.listFiles();

            if (index < 0 || index >= files.length) {
                this.session.writeln(fg(Color.RED) + 'Invalid disk index' + ansiReset());
                return;
            }

            const filePath = path.join(this.diskDir, files[index]);
            const size = fs.statSync(filePath).size;
            const isFinch = filePath.toUpperCase().endsWith('.FFI');
            const stride = isFinch ? FINCH_TRACK : HAWK_STRIDES.get(size);
            if (!stride || (isFinch && (!size || size % FINCH_PLAT || size > 4 * FINCH_PLAT)))
                throw new Error('Unsupported disk image size');
            const buffer = fs.readFileSync(filePath);
            if (buffer.length !== size) throw new Error('Disk image size changed while reading');
            const arrayBuf = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

            const image: DiskImage = {
                type: isFinch ? 'finch' : 'hawk',
                filename: files[index],
                stride,
                backing_data: arrayBuf,
                protect: false,
                data: new Uint8Array(arrayBuf),
            };

            // Mount to first available compatible drive.
            // For DSK2/Hawk, prefer unit 1 (Centurion "H1" convention)
            let mounted = false;
            const candidates = [...this.disks];
            if (!isFinch) {
                // Sort: Hawk unit 1 before unit 0
                candidates.sort((a, b) => {
                    if (a.type === 'dsk2' && b.type === 'dsk2') return b.unitIndex - a.unitIndex;
                    return 0;
                });
            }
            for (const disk of candidates) {
                if (!disk.container.image && disk.type === (isFinch ? 'finch' : 'dsk2')) {
                    disk.container.set_disk(image);
                    mounted = true;
                    this.session.writeln(
                        fg(Color.BRIGHT_GREEN) +
                        `Mounted ${files[index]} to ${disk.label}` +
                        ansiReset()
                    );
                    break;
                }
            }

            if (!mounted) {
                this.session.writeln(fg(Color.RED) + 'No compatible empty drive available' + ansiReset());
            }

            this.files = [];
        } catch (err: any) {
            this.session.writeln(fg(Color.RED) + `Error: ${err.message}` + ansiReset());
        }
    }

    private showNewDiskMenu(): void {
        let out = clearScreen() + cursorHome();
        out += fg(Color.BRIGHT_WHITE) + bg(Color.BLUE) + bold();
        out += '  SUPPORTED DISK FORMATS  ';
        out += ansiReset() + '\r\n\r\n';

        const templates = [
            { label: 'Hawk 400B sectors (5MB)', kind: 'hawk' as DiskType, stride: 400, size: 5196800 },
            { label: 'Hawk 512B sectors (6.5MB)', kind: 'hawk' as DiskType, stride: 512, size: 6651904 },
            { label: 'Finch 1-platter (8MB)', kind: 'finch' as DiskType, stride: FINCH_TRACK, size: FINCH_PLAT },
            { label: 'Finch 2-platter (16MB)', kind: 'finch' as DiskType, stride: FINCH_TRACK, size: FINCH_PLAT * 2 },
            { label: 'Finch 4-platter (32MB)', kind: 'finch' as DiskType, stride: FINCH_TRACK, size: FINCH_PLAT * 4 },
        ];

        for (let i = 0; i < templates.length; i++) {
            const t = templates[i];
            const sizeMB = (t.size / (1024 * 1024)).toFixed(1);
            out += `  ${t.label.padEnd(30)} ${sizeMB.padStart(8)}MB\r\n`;
        }

        out += '\r\n' + fg(Color.BRIGHT_BLACK);
        out += '  Create a file in the disks directory and select [L]oad.\r\n';
        out += '  [M] Back to menu' + ansiReset();

        this.session.write(out);
    }

    private showUnmountMenu(): void {
        this.showMenu();
        this.ejecting = true;
        this.session.writeln('Select the drive to unmount, or press M to cancel.');
    }

    private showDiskInfo(): void {
        let out = clearScreen() + cursorHome();
        out += fg(Color.BRIGHT_WHITE) + bg(Color.BLUE) + bold();
        out += '  DISK INFORMATION  ';
        out += ansiReset() + '\r\n\r\n';

        for (let i = 0; i < this.disks.length; i++) {
            const d = this.disks[i];
            out += fg(Color.BRIGHT_WHITE) + bold() + `  Drive ${i}: ${d.label}` + ansiReset() + '\r\n';
            out += `    Type: ${d.type.toUpperCase()}\r\n`;

            if (d.container.image) {
                const size = d.container.image.backing_data.byteLength;
                out += `    Image: ${d.container.image.filename}\r\n`;
                out += `    Size: ${size} bytes (${(size / 1024 / 1024).toFixed(2)} MB)\r\n`;
                out += `    Stride: ${d.container.image.stride} bytes/sector\r\n`;
                out += `    Sectors: ${Math.floor(size / d.container.image.stride)}\r\n`;
                out += `    Protected: ${d.container.image.protect ? 'Yes' : 'No'}\r\n`;
            } else {
                out += dim() + '    (no disk mounted)' + ansiReset() + '\r\n';
            }
            out += '\r\n';
        }

        out += fg(Color.BRIGHT_BLACK) + '  [M] Back to menu' + ansiReset();
        this.session.write(out);
    }
}
