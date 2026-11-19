import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export class FirmwareError extends Error {}

export function readFirmware(corePath: string): Record<string, Uint8Array> {
    const js = dirname(corePath);
    const filename = process.env.CENTURION_FIRMWARE ?
        resolve(process.env.CENTURION_FIRMWARE) : join(js, '..', 'firmware.json');
    let pack;
    try {
        pack = JSON.parse(readFileSync(filename, 'utf8'));
    } catch (error) {
        throw new FirmwareError(
            `Cannot read CenRE firmware at ${filename}. Supply a local pack with CENTURION_FIRMWARE. ${error.message}`,
        );
    }
    if (pack?.format !== 'cenre-firmware-v1' || !pack.roms || typeof pack.roms !== 'object') {
        throw new FirmwareError(`Invalid CenRE firmware pack: ${filename}`);
    }
    const lengths: Record<string, number> = JSON.parse(readFileSync(join(js, 'firmware-spec.json'), 'utf8'));
    const tables: Record<string, Uint8Array> = Object.create(null);
    for (const [name, length] of Object.entries(lengths)) {
        const encoded = pack.roms[name];
        if (typeof encoded !== 'string') {
            throw new FirmwareError(`Missing firmware table ${name} in ${filename}`);
        }
        const data = Buffer.from(encoded, 'base64');
        if (data.length !== length || data.toString('base64') !== encoded) {
            throw new FirmwareError(`Firmware table ${name} in ${filename} must contain ${length} bytes as base64`);
        }
        tables[name] = new Uint8Array(data);
    }
    return tables;
}
