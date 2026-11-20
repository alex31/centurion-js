import { CharDevice } from '../../../shared/interfaces';
import { sendTerminalInput, TerminalPort } from './input';

/** One-way lead from the JCL submitter's transmitter to the job console. */
export function connectJclLoopback(transmit: CharDevice, receive: TerminalPort) {
    const previous = transmit.get_dev();
    const queue: number[] = [];
    const lead: CharDevice = {
        name: 'JCL serial lead',
        emu_linked: true,
        rts: true,
        // The request line is short. Bound the queue if the console is stopped.
        can_receive: () => queue.length < 64,
        receive(value) {
            const byte = value & 127;
            // DC4 is sent during console setup, before any command is typed.
            if (byte !== 0x14 && this.can_receive()) queue.push(byte);
        },
        get_dev: () => transmit,
        bind_dev() {},
        set_cts() {},
        check_send() {},
    };
    transmit.bind_dev(lead);
    // Pace incoming characters so the native receiver can drain its latch.
    const timer = setInterval(() => sendTerminalInput(receive, queue), 90);
    return {
        reset: () => { queue.length = 0; },
        close: () => {
            clearInterval(timer);
            if (transmit.get_dev() === lead) transmit.bind_dev(previous);
        },
    };
}
