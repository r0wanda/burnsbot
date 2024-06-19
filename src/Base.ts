import { Collection, type Message, type MessageReaction, type PartialMessageReaction, type Guild, type SlashCommandBuilder, type CommandInteraction } from "discord.js";
import Cache from "./Cache.js";
import { type FileReadResult } from "node:fs/promises";
import type { GenericCmdInstance } from "./index.js";

export interface Action {
    start: number;
    length: number;
    title: string;
    user: string;
    icon: string;
    channel: string;
    msg: string;
    id: string;
}

export default class Base<A extends Action> extends Cache implements GenericCmdInstance {
    guild?: Guild;
    cache: FileReadResult<Buffer>;
    acts: A[];
    users: number;
    #action: (a: A) => Promise<void>;
    ids: Collection<string, Action>;
    isBase = true;
    data: SlashCommandBuilder;
    constructor(name: string) {
        super(name, async () => {
            this.cache = await this.fd.read();
            const a = JSON.parse(this.cache.buffer.toString('utf8', 0, this.cache.bytesRead));
            if (Array.isArray(a)) this.acts = a;
            else this.acts = a.acts;
        });
        this.#action = <(a: A) => Promise<void>><unknown>undefined;
        this.ids = new Collection<string, Action>();
        this.cache = {
            bytesRead: 0,
            buffer: Buffer.alloc(1)
        }
        this.acts = [];
        this.users = -1;
        this.data = <SlashCommandBuilder><unknown>undefined;
    }
    async write() {
        const w = await this.fd.write(JSON.stringify({
            acts: this.acts,
            ts: Date.now()
        }), 0);
        await this.fd.truncate(w.bytesWritten);
        this.cache = await this.fd.read({
            position: 0
        });
        if (this.cache.buffer.byteLength > 1) this.acts = JSON.parse(this.cache.buffer.toString('utf8', 0, this.cache.bytesRead)).acts;
    }
    setAction(act: (a: A) => Promise<void>) {
        this.#action = act;
    }
    fromId(id: string) {
        const a = this.ids.get(id);
        if (!a) throw new Error(`Couldn't find id ${id}`);
        return a;
    }
    async setGuild(guild: Guild) {
        this.guild = guild;
        this.users = guild.members.cache.reduce((a, v) => a + (v.user.bot || v.user.system ? 0 : 1), 0);
        console.log(`${this.users} human users found`);
        const prs: Promise<void>[] = [];
        for (const act of this.acts) {
            prs.push(this.#action(act));
        }
        await Promise.all(prs);
    }
    async action(a: A, add: (msg: Message) => Promise<void>, name?: string, fail?: string, errMsg?: string) {
        if (!this.guild) throw new Error('No guild found');
        const _channel = await this.guild.channels.fetch(a.channel);
        if (!_channel) throw new Error('No channel found');
        const channel = await _channel?.fetch();
        if (!channel.isTextBased()) throw new Error('Channel is not text channel');
        const msg = await channel.messages.fetch(a.msg);
        let ups = await msg.reactions.resolve(this.thumbUp)?.users.fetch();
        // timeouts
        let finalT: number | ReturnType<typeof setTimeout>;
        let majT: number | ReturnType<typeof setTimeout>;
        const idxOf = () => this.acts.findIndex(v => a.id === v.id);
        finalT = setTimeout(async () => {
            ups = await msg.reactions.resolve(this.thumbUp)?.users.fetch();
            const downs = await msg.reactions.resolve(this.thumbDown)?.users.fetch();
            if ((ups?.size || 0) > (downs?.size || 0)) {
                if (finalT) clearTimeout(finalT);
                if (majT) clearTimeout(majT);
                try {
                    const i = idxOf();
                    if (i >= 0) this.acts.splice(i, 1);
                    await this.write();
                } catch (err) { console.error(err); }
                try {
                    await add(msg);
                } catch (err) {
                    if (typeof err === 'string' || (<Error>err).toString) await msg.reply((<Error>err).toString());
                    else {
                        console.error(err);
                        await msg.reply(errMsg || `error occurred trying to add ${this.name} to server`);
                    }
                }
            } else {
                try {
                    this.acts.splice(idxOf(), 1);
                    await this.write();
                } catch (err) { console.error(err); }
                await msg.reply(`vote ended, ${fail ?? `${this.name} was not added`}`);
            }
        }, a.length - (Date.now() - a.start));
        const upd = async (react: MessageReaction | PartialMessageReaction) => {
            if (react.message.id !== msg.id) return;
            if (react.emoji.imageURL()) return; // imageurl only exists on custom emojis (thumbs up and down are not custom)
            if (![this.thumbUp, this.thumbDown].includes(react.emoji.toString())) return;
            if (!react.message.reactions) return;
            ups = await react.message.reactions.resolve(this.thumbUp)?.users.fetch();
            if (!ups) return;
            if (ups.size - 1 >= Math.round(this.users * 0.75) && !majT) {
                majT = setTimeout(add, 6e3);
                await msg.reply(`3/4ths of people have voted yes, ${name || `the ${this.name} will be added`} in 10 minutes (unless people remove their reactions)`);
            } else if (ups.size - 1 < Math.round(this.users * 0.75) && majT) {
                clearInterval(majT);
                // @ts-ignore
                majT = undefined;
            }
        }
        this.guild.client.on('messageReactionAdd', upd);
        this.guild.client.on('messageReactionRemove', upd);
        console.log(ups?.size);
        if (ups && ups.size - 1 >= Math.round(this.users * 0.75)) {
            await msg.reply(`3/4ths of people have voted yes, ${name || `the ${this.name} will be added`} in 10 minutes (unless people remove their reactions)`);
            majT = setTimeout(add, 6e5);
        }
    }
    async exec(_int: CommandInteraction): Promise<any> {};
}