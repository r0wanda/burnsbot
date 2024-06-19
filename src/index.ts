const bL = Date.now();
import { config } from 'dotenv';
import _ora from 'ora';
// @ts-ignore
import { join } from 'desm';
import notify from 'sd-notify';
import { join as pJoin } from 'node:path';
import { closeSync as close, readFileSync as rf } from 'node:fs';
import { readdir, type FileHandle } from 'node:fs/promises';
import { Client, Collection, GatewayIntentBits, REST, Routes, ActivityType,
    type SlashCommandBuilder, type CommandInteraction, type RESTPostAPIChatInputApplicationCommandsJSONBody, type Guild } from 'discord.js';
import Base, { type Action } from './Base.js';
import Server from './Server.js';
console.log(`${Date.now() - bL}ms to load mods`)

// setup
const ora = (text: string) => _ora({ text, spinner: 'bouncingBall' }).start();
config();
if (
    !process.env.TOKEN || !process.env.CLIENT || !process.env.GUILD ||
    !process.env.NGROK_AUTHTOKEN ||
    !process.env.DEVICE_TYPE || !process.env.OTHER_IP ||
    !process.env.BOT_CHANNEL || !process.env.RON)
    throw new Error('Missing either $TOKEN, $CLIENT, $GUILD, $NGROK_AUTHTOKEN, $DEVICE_TYPE, $OTHER_IP, $BOT_CHANNEL, or $RON environment variable(s)');

// version check
const ver: number[] = process.version.split('.').map(v => {
    return parseInt(v.replace(/\D/g, ''));
});
if (ver[0] < 18 ? true : ver[0] === 18 ? ver[1] < 20 : false) throw new Error(`Node.js version ${process.version} (${JSON.stringify(ver)}) is less than v18.20.0`);

// types
export interface GenericCmdInstance {
    data: SlashCommandBuilder;
    setGuild?: (guild: Guild) => Promise<void>;
    exec: (int: CommandInteraction) => Promise<void | string>;
    fromId?: (id: string) => Action;
    setIds?: (ids: Collection<string, Base<Action>>) => void;
    setUptime?: (st: number) => void;
    ready?: Promise<void> | boolean;
    fd?: FileHandle;
    closed?: boolean;
}
export interface GenericCmd {
    new(): GenericCmdInstance
}
export type ClientExtra = Client & {
    commands: Collection<string, GenericCmdInstance>;
    guild: Guild;
}

let server;
if (process.env.DEVICE_TYPE.toLowerCase() !== 'rpi') {
    server = await Server.connect(process.env.OTHER_IP);
} else server = new Server(process.env.OTHER_IP);

const client = <ClientExtra>new Client({
    intents: [
        ...<number[]>Object.values(GatewayIntentBits)
    ]
});
server.on('transfer', client.destroy);
server.on('start', () => {
    client.login();
});

// load commands
let spin = ora('Loading commands');
client.commands = new Collection();
const ids = new Collection<string, Base<Action>>();
const cmdDir = join(import.meta.url, 'cmds');
const cmds = await readdir(cmdDir, {
    recursive: true,
    withFileTypes: true
});
for (const name of cmds) {
    if (name.isDirectory() || !name.name.endsWith('js')) continue;
    // @ts-ignore
    const { default: Cmd }: { default: GenericCmd } = await import(pJoin(name.parentPath, name.name));
    const cmd = new Cmd();
    await cmd.ready;
    cmd.ready = false;
    if (!cmd.data || !cmd.exec) {
        spin.stop();
        console.warn(`Command ${name} is missing some or all properties`);
        spin.start();
    }
    else client.commands.set(cmd.data.name, cmd);
}

// handle exit
function exit() {
    for (const cmd of client.commands.values()) {
        try {
            if (cmd.fd && !cmd.closed) close(cmd.fd.fd);
        } catch {};
    }
    // @ts-ignore
    if (this.exit) process.exit();
}
const sigs: string[] = [
    'exit', 'uncaughtException',
    'SIGINT', 'SIGTERM', 'SIGHUP',
    'SIGUSR1', 'SIGUSR2'
]
let ready = false;

function isBase(b: GenericCmdInstance): boolean {
    return (<Base<Action>><unknown>b)?.isBase;
}

//for (const sig of sigs) process.on(sig, exit.bind({exit: sig !== 'exit'}));
client.on('interactionCreate', async int => {
    if (!int.isChatInputCommand()) return;
    const cmd = client.commands.get(int.commandName);
    if (!cmd) {
        console.error(`Command ${int.commandName} not found`);
        return;
    }
    if (!ready) {
        await int.reply({
            content: 'pshhh... mr burns is sleeping, try in a second',
            ephemeral: true
        });
        return;
    }
    console.log(`Recieved cmd ${int.commandName}`);
    try {
        if (cmd.setIds) cmd.setIds(ids);
        const e = await cmd.exec(int);
        if (e && isBase(cmd)) ids.set(e, <Base<Action>><unknown>cmd);
    } catch (err) {
        console.error(err);
        try {
            if (int.replied || int.deferred) await int.followUp({ content: `Error: ${err}`, ephemeral: true });
            else await int.reply({ content: `Error: ${err}`, ephemeral: true });
        } catch (err) {
            console.error(err);
        }
    }
});
const reload = true;
if (reload) {
    const rest = new REST();
    rest.setToken(process.env.TOKEN);
    spin.text = `Refreshing commands`;
    const body: RESTPostAPIChatInputApplicationCommandsJSONBody[] = []; // long ass type name
    for (const cmd of client.commands.values()) {
        body.push(cmd.data.toJSON());
    }
    await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT, process.env.GUILD),
        { body }
    );
    spin.succeed('Refreshed and loaded commands');
}

// login
client.on('ready', async c => {
    console.log(`Logged in as ${c.user.tag}`);
    c.user.setStatus('idle');
    c.user.setActivity({
        type: ActivityType.Custom,
        name: 'sleeping hang on a minute'
    });
    const _guild = [...(await client.guilds.fetch()).values()].find(g => g.id === process.env.GUILD);
    if (!_guild) throw new Error('No guild found');
    const guild = await _guild.fetch();
    const prs: Promise<void>[] = [];
    for (const cmd of client.commands.values()) {
        if (cmd.setGuild) prs.push(cmd.setGuild(guild));
        if (cmd.setUptime) cmd.setUptime(bL);
    }
    try {
        if (prs.length > 0) await Promise.all(prs);
    } catch (err) {
        console.error(err);
    }
    ready = true;
    console.log('Ready');
    notify.ready();
    c.user.setStatus('online');
    type StatArray = (string | number)[];
    let statuses: (string | StatArray)[];
    try {
        statuses = JSON.parse(rf(join(import.meta.url, 'statuses.json'), 'utf8')).stats;
    } catch (err) {
        console.error(err);
        console.error('Falling back to swbat');
        statuses = ['swbat'];
    }
    let stat: string | StatArray;
    const updStat = () => {
        let i;
        do {
            i = statuses[Math.floor(Math.random() * statuses.length)];
        } while (
            typeof i === typeof stat ?
                typeof i === 'string' ?
                    i === stat
                : (i.every((v, i) => v === stat[i]) || typeof i[0] !== 'string' || typeof i[1] !== 'number')
            : false);
        
        let type: number = ActivityType.Custom;
        let st;
        if (Array.isArray(i)) {
            type = <number>i[1] ?? ActivityType.Custom;
            st = <string>i[0] || 'swbat';
        } else st = i;
        c.user.setActivity({
            type,
            name: st
        });
    }
    updStat();
    setInterval(updStat, 6e4 * 5); // 5 minutes
});
client.login(process.env.TOKEN);
