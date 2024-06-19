import ns from 'node-netstat';
import Server from './Server.js';

// @ts-ignore
ns.parsers.linux = ns.parserFactories.linux({
    parseName: true
});

export default async function Netstat(tries: number, int?: number, port = 8089) {
    const fn = () => new Promise<boolean>(r => {
        ns({
            sync: true,
        }, i => {
            if (i.local.port === port) r(false);
        });
        r(true);
    });
    const s = Date.now();
    const r = await fn();
    if (r) return;
    const rr = await Server.retry(fn, int ?? Math.max((Date.now() - s) * 1.5, 1000), tries);
    if (rr) throw rr;
}