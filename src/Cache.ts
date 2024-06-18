import { join } from 'node:path';
import { existsSync as exists, constants, PathLike } from "node:fs";
import { access, mkdir, readFile, writeFile, lstat, open, rm, type FileHandle } from 'node:fs/promises';
import { type EventEmitter } from 'node:events';

export type FHandle = FileHandle & EventEmitter;

export default class Cache {
    ready: Promise<void> | boolean;
    name: string;
    fd: FHandle;
    cwd: string;
    closed: boolean;
    readonly thumbUp = '👍';
    readonly thumbDown = '👎';
    constructor(name: string, cb: () => Promise<void>) {
        if (!name || name.length < 1) throw new Error('Name cannot be empty');
        this.name = name;
        this.closed = true;
        this.cwd = process.cwd();
        this.fd = <FHandle><unknown>undefined;
        this.ready = this.#init(cb);
    }
    async #init(cb: () => Promise<void>) {
        const RW = constants.R_OK | constants.W_OK;

        // dir
        const dirP = join(this.cwd, 'cmdcache');
        if (exists(dirP)) {
            const dStat = await lstat(dirP);
            if (!dStat.isDirectory()) {
                await rm(dirP);
                await mkdir(dirP);
            }
            await access(dirP, RW);
        } else {
            await mkdir(dirP);
            await access(dirP, RW);
        }

        // file
        const fileP = join(dirP, this.name);
        if (!exists(fileP)) await writeFile(fileP, '[]');
        await access(fileP);

        this.fd = <FHandle>await open(fileP, 'r+');
        this.closed = false;
        this.fd.on('close', () => {
            this.closed = true;
        });
        await cb();
    }
    async createFd(path: PathLike) {
        if (!exists(path)) await writeFile(path, '[]');
        await access(path);

        return <FHandle>await open(path, 'r+');
    }
}