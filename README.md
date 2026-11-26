# Centurion CPU-6 JavaScript emulator

This fork runs the microcoded CPU6, Hawk and Finch drives, and two Centurion CRTs in Node.js. It derives from Meisaka Yukara's CenRE and billsargent's server adaptation. [License](LICENSE.txt) · [Attribution](NOTICE.md)

## Build and boot CENTOS

From the root of the Centurion SDCC distribution, prepare the local firmware pack and disk image using the distribution's build instructions. The JavaScript build requires Node.js 20 or newer and npm. [Distribution build guide](https://github.com/alex31/centurion_centos6_sdcc#build)

```sh
make emulator
run/centurion-system-js /path/to/CENTOS_13.IMG
```

If you built the distribution's application image with `./dobuild`, launch `run/centurion-system-js` without an argument to mount it. Open the console and click **Boot CENTOS** on CRT0. **Load image** accepts a Hawk image for DSK2 unit 1. **Save image** downloads a copy with guest writes. [Local web console](http://127.0.0.1:42646/)

## Services

| Port | Interface | Function |
| --- | --- | --- |
| 2323 | Telnet | Control panel with registers and run, halt and step controls |
| 2324 | Telnet | CRT0 |
| 2325 | Telnet | CRT1 |
| 2326 | Telnet | Disk manager for Hawk and Finch drives |
| 2327 | Raw serial | MUX channel 1 |
| 42646 | HTTP and WebSocket | Browser console, both CRTs and Hawk image transfer |

The server's local command line accepts `run`, `halt`, `step`, `reset` and `quit`. At CRT0 over Telnet, enter `H1` at the ROM's `D=` prompt, accept system disk 1, then enter the date and time. [CENTOS boot and application commands](https://github.com/alex31/centurion_centos6_sdcc#start-a-centos-session)
