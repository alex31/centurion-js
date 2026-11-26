# NOTICE — Licensing & Attribution

## Project

**Centurion CPU-6 Emulator + Telnet/WebSocket server** ("Emu 0.22").

This repository is a **modified and extended version** of the CenRE (Centurion
RE) emulator. It is distributed under the **CenRE License** — see
[`LICENSE.txt`](./LICENSE.txt), which is included unmodified and must remain
with any redistribution of this software.

> Per CenRE License condition 4, this tree is **plainly marked as a modified /
> derived work** and must **not** be misrepresented as the original CenRE
> software.

## Copyright & origin

- The microcoded CPU, peripherals and original terminal implementation in
  `src/cen.ts` derive from CenRE, Copyright (c) 2023 Meisaka Yukara.
- The Telnet/WebSocket server and Node.js bridge in `server/` derive from
  billsargent's server adaptation. This fork supplies a browser console in
  `web/`, builds the JavaScript core from TypeScript and loads firmware
  tables from a separate local pack.

No claim is made to have written the original CenRE software, and nothing here
implies endorsement by the copyright holder (CenRE License condition 5).

## Third-party components

The build uses TypeScript to compile the sources. The server uses the
`ws` package for WebSocket connections. The lockfile records the versions
and the packages carry their own license notices. [Dependencies](package.json)

## Runtime patches (modified code)

`server/src/core/amd-loader.ts` loads the generated CenRE core and applies
runtime patches for headless execution, sense switches and access to
emulated devices. The distribution's firmware import uses the table names
and sizes in the [firmware specification](src/firmware-spec.json).

## Contact

If any attribution above is incomplete or incorrect, please open an issue in
this repository so it can be corrected.
