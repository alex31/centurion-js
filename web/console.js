'use strict';

const connection = document.getElementById('connection');
const notice = document.getElementById('notice');
const filePicker = document.getElementById('image-file');
const loadButton = document.getElementById('load-image');
const saveButton = document.getElementById('save-image');
const buttons = Array.from(document.querySelectorAll('[data-action]'));
const speeds = ['realtime', 'maximum'].map(mode => [mode, document.getElementById('speed-' + mode)]);
const terminals = [0, 1].map(port => ({
    screen: document.getElementById('crt' + port),
    status: document.getElementById('crt' + port + '-status'),
    boot: document.querySelector(`.boot[data-port="${port}"]`),
    lastFrame: '',
}));
const registerIDs = ['a', 'b', 'x', 'y', 'z', 's', 'c', 'p'];
const arrowKeys = new Map([
    ['ArrowUp', '\x1b[A'], ['ArrowDown', '\x1b[B'],
    ['ArrowRight', '\x1b[C'], ['ArrowLeft', '\x1b[D'],
]);
const specialKeys = new Map([
    ['Enter', '\r'], ['Backspace', '\x7f'], ['Delete', '\x7f'], ['Escape', '\x1b'],
    ['PageUp', '\x1b[5~'], ['PageDown', '\x1b[6~'],
]);
let socket;
let state;
let stopped = false;
let busy = false;
let bootFromImage = null;
let reconnecting = false;
let retryDelay = 100;
let retryTimer;

function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
}

function report(message, error = false) {
    setText(notice, message);
    notice.classList.toggle('error', error);
}

function hex(value, width) {
    return value.toString(16).toUpperCase().padStart(width, '0');
}

function drawScreen(terminal, data) {
    const frame = data ? String.fromCharCode(...data.cells, data.x, data.y) : '';
    if (frame === terminal.lastFrame) return;
    terminal.lastFrame = frame;
    if (!data) {
        terminal.screen.replaceChildren();
        return;
    }
    const fragment = document.createDocumentFragment();
    for (let y = 0; y < 25; y++) {
        const row = document.createElement('div');
        let text = '';
        let style = -1;
        const flush = () => {
            if (!text) return;
            if (style === 0) {
                row.append(document.createTextNode(text));
            } else {
                const run = document.createElement('span');
                if (style & 0x0100) run.classList.add('half');
                if (style & 0x0200) run.classList.add('blink');
                if (style & 0x1000) run.classList.add('reverse');
                if (style & 0x2000) run.classList.add('under');
                if (style & 1) run.classList.add('cursor');
                run.textContent = text;
                row.append(run);
            }
            text = '';
        };
        for (let x = 0; x < 80; x++) {
            const cell = data.cells[y * 80 + x];
            const attrs = (cell & 0x3300) | Number(data.x === x && data.y === y);
            if (attrs !== style) {
                flush();
                style = attrs;
            }
            const code = cell & 127;
            text += cell & 0x0400 || code < 32 || code === 127 ? ' ' : String.fromCharCode(code);
        }
        flush();
        fragment.append(row);
    }
    terminal.screen.replaceChildren(fragment);
}

function render() {
    const online = socket?.readyState === WebSocket.OPEN && !!state && !stopped;
    const speed = state?.speed === 'realtime' ? 'Real time' : state?.speed === 'maximum' ? 'Maximum speed' :
        state ? `${state.rate.toLocaleString()} steps/tick` : '';
    const factor = state?.speed === 'maximum' && Number.isFinite(state.speedFactor)
        ? ' · ' + state.speedFactor.toLocaleString(undefined,
            {minimumFractionDigits: 1, maximumFractionDigits: 1}) + '×'
        : '';
    setText(connection, stopped ? 'Server stopped' : online ?
        (state.running ? 'Running · ' + speed + factor : 'Paused') :
        reconnecting ? 'Reconnecting' : 'Connecting');
    for (const [mode, input] of speeds) {
        input.checked = state?.speed === mode;
        input.disabled = !online || busy;
    }
    for (const button of buttons) {
        const action = button.dataset.action;
        button.disabled = !online || busy || (action === 'run' && state.running) ||
            (action === 'pause' && !state.running) ||
            (action === 'step' && state.running);
    }
    loadButton.disabled = !online || busy;
    saveButton.disabled = !online || busy || !state.canSave;
    for (let i = 0; i < terminals.length; i++) {
        const terminal = terminals[i];
        const data = state?.terminals[i];
        terminal.boot.disabled = !online || busy || !data?.bootReady;
        setText(terminal.status, data?.available === false ? 'Raw serial is using this terminal' :
            data?.bootStatus || (data?.bootReady && !state.canSave ?
                'No system disk is mounted. Click Boot CENTOS to select an image.' : ''));
        if (state) drawScreen(terminal, data);
    }
    if (!state) return;
    for (const [name, value] of Object.entries({
        pc: hex(state.pc, 4), level: hex(state.level, 1), map: hex(state.map, 1), cc: hex(state.cc, 1),
    })) setText(document.getElementById(name), value);
    state.registers.forEach((value, i) => setText(document.getElementById('reg-' + registerIDs[i]), hex(value, 4)));
    const list = document.getElementById('disk-list');
    const descriptions = state.disks.map(disk => disk.label + ' · ' + (disk.filename ?
        `${disk.filename} (${disk.stride}-byte stride)` : 'Empty'));
    if (JSON.stringify(descriptions) !== list.dataset.images) {
        list.dataset.images = JSON.stringify(descriptions);
        list.replaceChildren(...descriptions.map(description => {
            const li = document.createElement('li');
            li.textContent = description;
            return li;
        }));
    }
}

function retryConnection() {
    if (retryTimer === undefined) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    if (!stopped) connect();
}

function connect() {
    socket = new WebSocket('ws://' + location.host + '/console');
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'state') {
            state = message;
            reconnecting = false;
            retryDelay = 100;
            render();
        } else if (message.type === 'error') {
            report(message.message, true);
        }
    };
    socket.onclose = () => {
        state = undefined;
        reconnecting = true;
        render();
        if (!stopped) {
            retryTimer = setTimeout(retryConnection, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 500);
        }
    };
}

window.addEventListener('focus', retryConnection);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) retryConnection();
});

function send(message) {
    if (socket?.readyState === WebSocket.OPEN && !stopped) socket.send(JSON.stringify(message));
}

function localClock() {
    const now = new Date();
    const two = number => String(number).padStart(2, '0');
    return {
        date: [now.getMonth() + 1, now.getDate(), now.getFullYear() % 100].map(two).join(''),
        time: [now.getHours(), now.getMinutes(), now.getSeconds()].map(two).join(''),
    };
}

function selectImage(bootPort = null) {
    bootFromImage = bootPort;
    filePicker.click();
}

for (const [port, terminal] of terminals.entries()) {
    terminal.screen.addEventListener('keydown', event => {
        if (event.altKey || event.metaKey || event.isComposing) return;
        if (event.ctrlKey && event.key.toLowerCase() === 'v') return; // Browser paste.
        const key = event.ctrlKey && /^[a-z]$/i.test(event.key)
            ? String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64)
            : arrowKeys.get(event.key) ?? specialKeys.get(event.key) ??
              (/^[\x20-\x7e]$/.test(event.key) ? event.key : undefined);
        if (key === undefined) return;
        event.preventDefault();
        send({type: 'key', port, key});
    });
    terminal.screen.addEventListener('paste', event => {
        const text = event.clipboardData?.getData('text') ?? '';
        event.preventDefault();
        if (text.length > 4096) report('Paste up to 4096 characters at a time', true);
        else send({type: 'paste', port, text});
    });
    terminal.boot.addEventListener('click', () => {
        if (!state?.canSave) {
            selectImage(port);
            return;
        }
        send({type: 'boot', port, ...localClock()});
        terminal.screen.focus();
    });
}

async function post(url, body) {
    busy = true;
    render();
    try {
        const response = await fetch(url, {method: 'POST', body});
        const message = await response.text();
        if (!response.ok) throw new Error(message);
        return message;
    } finally {
        busy = false;
        render();
    }
}

for (const [mode, input] of speeds) {
    input.addEventListener('change', async () => {
        if (!input.checked) return;
        try {
            await post('/api/control?action=speed&mode=' + mode);
            report('');
        } catch (error) {
            report(error.message, true);
        }
    });
}

for (const button of buttons) {
    button.addEventListener('click', async () => {
        const action = button.dataset.action;
        if (action === 'shutdown' && !window.confirm(
            'Stop the server? Download the disk image first to keep its changes.')) return;
        if (action === 'reset' && !window.confirm('Reset the CPU and clear both terminals?')) return;
        try {
            const result = await post('/api/control?action=' + action);
            if (action === 'shutdown') {
                stopped = true;
                render();
            }
            report(action === 'shutdown' ? result : '');
        } catch (error) {
            report(error.message, true);
        }
    });
}

loadButton.addEventListener('click', () => selectImage());
filePicker.addEventListener('cancel', () => { bootFromImage = null; });
filePicker.addEventListener('change', async () => {
    const file = filePicker.files[0];
    const bootPort = bootFromImage;
    bootFromImage = null;
    filePicker.value = '';
    if (!file) return;
    if (file.size !== 5196800 && file.size !== 6651904) {
        report('Select a 5,196,800 or 6,651,904 byte Hawk image', true);
        return;
    }
    if (!state) {
        report('Server is disconnected', true);
        return;
    }
    if (state.canSave && !window.confirm(
        'Replace the mounted image and reset the CPU? Download the current image first to keep its changes.')) return;
    report('Loading image…');
    try {
        const parameters = new URLSearchParams({name: file.name});
        if (bootPort !== null) {
            const {date, time} = localClock();
            parameters.set('boot', String(bootPort));
            parameters.set('date', date);
            parameters.set('time', time);
        }
        report(await post('/api/disk?' + parameters, file));
        terminals[bootPort ?? 0].screen.focus();
    } catch (error) {
        report(error.message, true);
    }
});
saveButton.addEventListener('click', () => {
    location.assign('/api/disk');
});

connect();
render();
