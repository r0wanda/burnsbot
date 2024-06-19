import Ws from 'ws';
import got from 'got';
import _ora from 'ora';
import express from 'express';
import expressWs from 'express-ws';
import crypto from 'node:crypto';
import { join } from 'node:path';
import EventEmitter from 'node:events';
import { existsSync as ex } from 'node:fs';
import { cp, rm, mkdir, writeFile as wf, readFile as rf, readdir } from 'node:fs/promises';

const ora = (text: string) => _ora({ text, spinner: 'bouncingBall' }).start();

export default class Server extends EventEmitter {
    transPort: number;
    transApp: expressWs.Application;
    server: ReturnType<expressWs.Application['listen']>;
    /**
     * Web server constructor
     * @param ip string
     * @param port DEPRECATED: WILL BREAK IF NOT SYNCED - port for transmissions between rpi and computer
     */
    constructor(ip: string, port = 8089) {
        super();
        this.transPort = port;
        this.transApp = <expressWs.Application><unknown>express();
        expressWs(this.transApp);
        async function getCache() {
            const c: { [key: string]: any; } = {};
            const cache = join(process.cwd(), 'cmdcache');
            if (!ex(cache)) throw new Error('cache is empty');
            const d = await readdir(cache);
            if (d.length < 1) throw new Error('cache is empty');
            for (const f of d) {
                c[f] = await rf(join(cache, f), 'utf8');
            }
            return c;
        }
        this.transApp.get('/ping', (req, res) => {
            console.log('got ping from other server, prepare for exit routine');
            res.send('pong');
        });
        this.transApp.ws('/shut', async (ws, req) => {
            ws.on('message', async (d) => {
                if (d.toString('utf8') !== 'ok') return;
                ws.send('start');
                try {
                    await Server.connect(ip, port, false);
                    ws.send('ok');
                } catch {
                    ws.send('error');
                }
                ws.close();
            });
        });
        this.transApp.get('/', (req, res) => {
            res.send('you found mr burns\' web server! very cool');
        });
        this.transApp.ws('/', (ws, req) => {
            this.emit('transfer');
            console.log('exit routine starting! websocket established, no more commands accepted.');
            let done = false;
            ws.on('message', async (data) => {
                let d = data.toString('utf8');
                switch (d) {
                    case 'ok':
                    case 'err': {
                        const c = JSON.stringify(await getCache());
                        const hshAlg = crypto.createHash('sha256');
                        hshAlg.update(c);
                        const hsh = hshAlg.digest('hex');
                        ws.send(`cache${hsh}${c}`);
                        break;
                    }
                    case 'allgood':
                        done = true;
                        this.emit('shutdown');
                        ws.close();
                        break;
                }
            });
            ws.on('close', () => {
                if (!done) {
                    console.log('nvm exit routine aborted');
                    this.emit('start');
                }
            });
        });
        this.server = this.transApp.listen(port);
    }
    static retry(fn: (tries: number) => (void | boolean | Promise<void | boolean>), int = 1000, tries = 10) {
        return new Promise<AggregateError | false>((r) => {
            let t = 0;
            const errs: unknown[] = [];
            const f = async () => {
                try {
                    const f = await fn(t);
                    if (typeof f === 'boolean' && !f) throw new Error();
                    clearInterval(i);
                    r(false);
                } catch (err) {
                    errs.push(err);
                    t++;
                }
                if (t >= tries) {
                    clearInterval(i);
                    r(new AggregateError(errs));
                }
            }
            f();
            const i = setInterval(f, int);
        });
    }
    static async refreshCache(c: { [key: string]: any[] }, spin: ReturnType<typeof ora>) {
        spin.text = 'Copying old cache';
        const cwd = process.cwd();
        const cache = join(cwd, 'cmdcache');
        const oCache = join(cwd, 'oldcache');
        const chEx = ex(cache);
        const oChEx = ex(oCache);
        if (chEx && oChEx) await rm(oCache, {
            recursive: true,
            force: true
        });
        if (chEx) {
            await cp(cache, oCache, {
                recursive: true
            });
            await rm(cache, {
                recursive: true,
                force: true
            });
            await mkdir(cache);
        } else await mkdir(cache);
        spin.text = 'Writing new cache';
        for (const k in c) {
            await wf(join(cache, k), c[k]);
        }
        const dir = await readdir(cache);
        if (Object.keys(c).some(f => !dir.includes(f))) throw new Error('Not all files were written while updating cache');
        spin.succeed('Cache backed up and refreshed');
    }
    static shut(ip: string, port = 8089) {
        return new Promise<void>(async r => {
            const url = `http://${ip}:${port}/`;
            await Server._ping(ip, port);
            const ws = new Ws(`${url}shut`);
            ws.on('message', (d) => {
                if (d.toString('utf8') === 'error') throw new Error('error shutting down');
                else if (d.toString('utf8') === 'ok') r(console.log('shutdown ok'));
            });
            ws.on('open', () => {
                ws.send('ok');
            });
        });
    }
    static async _ping(ip: string, port = 8089) {
        const url = `http://${ip}:${port}/`;
        const tries = process.env.DEVICE_TYPE === 'rpi' ? 50 : 10;
        let spin = ora(`Pinging alt server (try 0/${tries})`);
        try {
            const r = await Server.retry(async (t) => {
                spin.text = `Pinging alt server (try ${t}/${tries})`;
                const r = await got(`${url}ping`, {
                    timeout: {
                        response: 2000
                    },
                }).text();
                if (r !== 'pong') return false;
            }, 2000, tries);
            if (r) throw r;
        } catch (err) {
            spin.fail();
            throw err;
        }
        spin.succeed('Alt server is alive');
    }
    static async connect(ip: string, port?: number, ret?: true): Promise<Server>
    static async connect(ip: string, port?: number, ret?: false): Promise<void>
    static async connect(ip: string, port = 8089, ret = true): Promise<void | Server> {
        const url = `http://${ip}:${port}/`;
        try {
            await Server._ping(ip, port);
        } catch (err) {
            console.error(err);
            if (ret) return new Server(ip, port);
        }
        let spin = ora('Connecting to alt server websocket');
        const ev = new class extends EventEmitter { };
        let cache: { [key: string]: any[]; } = {};
        const ws = new Ws(`${url}`);
        ws.on('error', console.error);
        ws.on('message', (data) => {
            let d = data.toString('utf8');
            if (d.startsWith('cache')) {
                /*
                 * format is "cache{data hash}{data}"
                 * where {data} is all of the current cached commands in format { "filename": [data] }
                 * and where {data hash} is a sha256 hash of the data
                 */
                d = d.slice(5); // length of "cache"
                const hsh = d.slice(0, 64);
                const data = d.slice(64);
                spin.text = `Recieved transmission, reported hash: ${hsh}`;
                try {
                    const hAlg = crypto.createHash('sha256');
                    hAlg.update(data);
                    const nHsh = hAlg.digest('hex');
                    if (nHsh !== hsh) {
                        spin.text = 'Recieved hash does not match!';
                        throw new Error();
                    }
                    cache = JSON.parse(data);
                    ev.emit('cache');
                } catch (err) {
                    console.error(err);
                    ws.send('err');
                }
            } else ws.send('err');
        });
        ws.on('open', () => {
            spin.text = 'Connected to websocket and sent signal, waiting for response';
            ws.send('ok');
        });
        await new Promise(r => ev.on('cache', r));
        spin.succeed('Hash matched and JSON ok!');
        spin = ora('Setting up cache');
        await Server.refreshCache(cache, spin);
        let s: Server | undefined;
        if (ret) s = new Server(ip, port);
        ws.send('allgood');
        if (ret && s) return s;
    }
}
