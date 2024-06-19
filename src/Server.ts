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

export interface CmdCache {
    [key: string]: any[] | {
        acts: any[],
        ts: number
    }
}
export interface CmdCacheNorm {
    [key: string]: string;
}

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
                let c: CmdCacheNorm = {};
                let e = false;
                switch (d) {
                    case 'ok':
                    case 'err': {
                        c = await Server.getCache(true);
                        const cs = JSON.stringify(c);
                        const hshAlg = crypto.createHash('sha256');
                        hshAlg.update(cs);
                        const hsh = hshAlg.digest('hex');
                        ws.send(`cache${hsh}${cs}`);
                        break;
                    }
                    case 'allgood':
                        done = true;
                        if (e) await Server.refreshCache(c, ora('Copying old cache'));
                        this.emit('shutdown');
                        ws.close();
                        break;
                    default: {
                        if (d.startsWith('new')) {
                            if (!e) e = true;
                            /*
                             * format is "cache{key hash}{data hash}{key}|{data}"
                             * where {data} is a single cached command in format [data] or { acts: [data], ts: *timestamp* }
                             * and where {data hash} is a sha256 hash of the data and {key hash} is a sha256 hash of the key
                             */
                            d = d.slice(3); // length of "new"
                            const kHsh = d.slice(0, 64);
                            const hsh = d.slice(64, 128);
                            const main = d.slice(128);
                            const [key, data] = main.split('|');
                            console.log(`Replacing outdated cache item ${key}, reported hash: ${hsh}, key hash ${kHsh}`);
                            try {
                                let hAlg = crypto.createHash('sha256');
                                hAlg.update(key);
                                const nKHsh = hAlg.digest('hex');
                                hAlg.destroy();
                                hAlg = crypto.createHash('sha256');
                                hAlg.update(data);
                                const nHsh = hAlg.digest('hex');
                                if (nHsh !== hsh || nKHsh !== kHsh) {
                                    console.warn('Recieved hash does not match!');
                                    throw new Error();
                                }
                                c[key] = data;
                                ws.send('ok');
                            } catch (err) {
                                console.error(err);
                                ws.send('err');
                            }
                        }
                    }
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
    static async getCache(str?: false): Promise<CmdCache>
    static async getCache(str?: true): Promise<CmdCacheNorm>
    static async getCache(str = false): Promise<CmdCache | CmdCacheNorm> {
        const c: { [key: string]: any; } = {};
        const cache = join(process.cwd(), 'cmdcache');
        if (!ex(cache)) throw new Error('cache is empty');
        const d = await readdir(cache);
        if (d.length < 1) throw new Error('cache is empty');
        for (const f of d) {
            const r = await rf(join(cache, f), 'utf8');
            c[f] = str ? r : JSON.parse(r);
        }
        return c;
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
    static async refreshCache(c: CmdCacheNorm, spin: ReturnType<typeof ora>) {
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
    static async reconstructCache(ws: Ws, cache: CmdCacheNorm): Promise<CmdCacheNorm> {
        let spin = ora('Reconstructing cache');
        let ch: CmdCacheNorm = {};
        const loc = await Server.getCache(false);
        const errs: unknown[] = [];
        for (const k in cache) {
            let v: CmdCache[''];
            let lv: CmdCache[''] = loc[k];
            try {
                v = JSON.parse(cache[k]);
            } catch (err) {
                errs.push(err);
                continue;
            }
            if (
                !lv ||
                (!Array.isArray(v) && Array.isArray(lv)) ||
                (!Array.isArray(v) && !Array.isArray(lv) && v.ts > lv.ts)
            ) ch[k] = JSON.stringify(Array.isArray(v) ? v : v.acts);
            else {
                ch[k] = JSON.stringify(Array.isArray(lv) ? lv : lv.acts);
                let retry = true;
                do {
                    retry = false;
                    try {
                        let hshAlg = crypto.createHash('sha256');
                        hshAlg.update(k);
                        const kHsh = hshAlg.digest('hex');
                        hshAlg.destroy();
                        hshAlg = crypto.createHash('sha256');
                        hshAlg.update(ch[k]);
                        const hsh = hshAlg.digest('hex');
                        ws.send(`new${kHsh}${hsh}${k}|${ch[k]}`);
                        await new Promise<void>(r => {
                            ws.once('message', d => {
                                const m = d.toString('utf8');
                                if (m === 'ok') r();
                                else if (m === 'err') throw new Error('Invalid hash');
                            });
                        });
                    } catch (err) {
                        retry = true;
                        errs.push(err);
                    }
                } while (retry);
            }
        }
        if (errs.length) {
            spin.fail('Error(s) occured reconstructing cache');
            console.error(new AggregateError(errs));
        }
        return ch;
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
        let cache: CmdCacheNorm = {};
        const ws = new Ws(`${url}`);
        ws.on('error', console.error);
        ws.on('message', (data) => {
            let d = data.toString('utf8');
            if (d.startsWith('cache')) {
                /*
                 * format is "cache{data hash}{data}"
                 * where {data} is all of the current cached commands in format { "filename": [data] }
                 * or { "filename": { acts: [data], ts: *timestamp* } }
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
        ws.removeAllListeners('message');
        spin.succeed('Hash matched and JSON ok!');
        spin = ora('Setting up cache');
        const normCache = await this.reconstructCache(ws, cache);
        await Server.refreshCache(normCache, spin);
        let s: Server | undefined;
        if (ret) s = new Server(ip, port);
        ws.send('allgood');
        if (ret && s) return s;
    }
}
