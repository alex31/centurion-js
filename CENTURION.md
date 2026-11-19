# Centurion JavaScript CPU6 emulator

This branch is a modified distribution of billsargent's CenRE-based
emulator, using source files from commit `2bf355026e3f5d4ebdf51138088b9499ccb31b09`
on the `upstream-software` branch, with the historical data tables
externalized. [Upstream revision](https://github.com/billsargent/centurion/tree/2bf355026e3f5d4ebdf51138088b9499ccb31b09)

- The existing microcoded CPU6 runs the SDCC-generated `MUL`, `DIV` and
  wide arithmetic instructions. The distribution smoke test verifies
  multiplication, quotient and remainder on the rebuilt core.
- The Node.js server supports mounting a caller-supplied Hawk image and
  saving a new copy of the mounted image. It uses the mode-7 tick rate,
  binds to loopback by default and offers a raw CRT1 serial connection.
- The local web console shares the emulated machine with the Telnet service.
  It renders both CRTs from the native terminal model and provides CPU
  controls, image upload and download, and server shutdown. **Boot CENTOS**
  follows the ROM and CENTOS prompts using the browser's local date and time.
  At an empty drive it opens the image picker, then boots the selected disk.
- CENTOS single-key input and CRT escape handling work with the local
  Telnet and virtual terminal changes.
- The build regenerates the JavaScript from TypeScript with locked npm
  dependencies. At startup the server reads the local firmware pack named by
  `CENTURION_FIRMWARE` or `firmware.json` beside the built emulator directories.
  The table sizes and format are checked before the CPU starts. The firmware
  pack contains the bootstrap, microcode, diagnostics and other data tables
  originally initialized by CenRE.

See [LICENSE.txt](LICENSE.txt) and [NOTICE.md](NOTICE.md) for the CenRE
license and attribution.
