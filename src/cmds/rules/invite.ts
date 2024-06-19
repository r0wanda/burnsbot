import { EmbedBuilder, hyperlink, type Guild, TextBasedChannel } from "discord.js";
import { SlashCommandBuilder, type CommandInteraction } from "discord.js";
import { randomUUID } from "node:crypto";
import Base, { type Action } from "../../Base.js";
import { FHandle } from "../../Cache.js";
import { join } from "node:path";

const botChannel = process.env.BOT_CHANNEL!;
const ron = process.env.RON!;

export interface InviteAct extends Action {
    userId: string;
}

export default class Sticker extends Base<InviteAct> {
    data: SlashCommandBuilder;
    inv: string;
    white?: string[];
    whiteFd?: FHandle
    whiteCache?: typeof this['cache'];
    channel?: TextBasedChannel;
    constructor(inv: string) {
        super('invite');
        this.setAction(this.action);
        this.inv = inv;
        // @ts-ignore
        this.data = new SlashCommandBuilder()
                    .setName('invite')
                    .setDescription('invite a user to the server')
                    .addIntegerOption(opt =>
                        opt.setName('user')
                        .setDescription('the user id')
                        .setRequired(true))
                    .addIntegerOption(opt =>
                        opt.setName('hours')
                           .setDescription('number of hours after which the votes will be finalized')
                    )
    }
    async setGuild(guild: Guild) {
        await super.setGuild(guild);
        await this.whitelist();
    }
    async whiteRead() {
        this.whiteCache = await this.fd.read({
            position: 0
        });
        this.white = JSON.parse(this.whiteCache.buffer.toString('utf8', 0, this.whiteCache.bytesRead));
    }
    async whiteWrite() {
        const w = await this.fd.write(JSON.stringify(this.acts), 0);
        await this.fd.truncate(w.bytesWritten);
        await this.whiteRead();
    }
    async whitelist() {
        if (!this.guild) throw new Error('Guild not found'); // should never happen
        if (!this.whiteFd) {
            this.whiteFd = await this.createFd(join(process.cwd(), 'whitelist'));
            this.whiteCache = await this.whiteFd.read();
            this.white = JSON.parse(this.whiteCache.buffer.toString('utf8', 0, this.whiteCache.bytesRead));
        }
        if (!this.white || !Array.isArray(this.white)) throw new Error('Malformed whitelist');
        if (!this.channel) {
            const _ch = await this.guild.channels.fetch(botChannel);
            const ch = await _ch?.fetch();
            if (!ch || !ch.isTextBased()) throw new Error('Bot channel is invalid');
            this.channel = ch;
        }
        if (!this.channel) throw new Error('Bot channel is invalid');
        const mems = await this.guild.members.list();
        for (const m of mems.values()) {
            if (m.id === ron || m.id === (await this.guild.members.fetchMe()).id || this.white.includes(m.id)) continue;
            try {
                await m.kick();
                await this.channel.send(`kicked <@${m.id}> (${m.user.tag || m.user.username})`);
            } catch (err) {
                try {
                    await this.channel.send(`failed to kick <@${m.id}>: ${err}`);
                } catch (err) { console.error(err); };
            }
            break;
        }
    }
    async action(a: InviteAct) {
        await super.action(a, async (msg) => {
            await msg.reply(`user whitelisted, send them ${hyperlink('this link', this.inv)}`);
        });
    }
    async exec(int: CommandInteraction) {
        if (!this.guild) {
            await int.reply({
                content: 'hold up, try again in a couple seconds',
                ephemeral: true
            });
            return;
        }
        const user = int.options.get('user', true).value;
        if (!user || typeof user !== 'number') {
            await int.reply({
                content: 'send an actual user next time',
                ephemeral: true
            });
            return;
        }
        let u;
        try {
            u = await this.guild.client.users.fetch(user.toString());
        } catch (err) {
            await int.reply({
                content: 'you have to use a user id (ask rowan how to get one)',
                ephemeral: true
            });
            return;
        }
        if (!u) {
            await int.reply({
                content: 'you have to use a user id (ask rowan how to get one)',
                ephemeral: true
            });
            return;
        }

        let rawHrs = int.options.get('hours')?.value ?? '2';
        let hrs = parseInt(rawHrs.toString());
        let ridicule = 0;
        if (isNaN(hrs)) hrs = 2;
        if (hrs < 1 || hrs > 48) ridicule = hrs = 2;
        const id = randomUUID();

        const emb = new EmbedBuilder()
                    .setColor(0x2a54d3)
                    .setTitle(`sticker proposal`)
                    .setDescription(`${int.user.displayName} wants to invite ${u.tag || u.username} (<@${u.id}>) to the server`)
                    .addFields([
                        {
                            name: 'voting',
                            value: 'react with :thumbsup: to add the sticker, react :thumbsdown: to deny the addition'
                        },
                        {
                            name: 'rules',
                            value: 'if 3/4ths of the server votes yes, it will be put in place 10 minutes afterwards, as long as the votes never drop below 3/4ths\n'
                            + `if a 3/4ths majority is not reached, the majority vote will be chosen in ${hrs} hours`
                        },
                        {
                            name: 'notes',
                            value: 'don\'t vote for both if you are indifferent, because if a 3/4ths majority is reached, thumbs down are ignored'
                        }
                    ])
                    .setAuthor({
                        name: int.user.displayName,
                        iconURL: int.user.avatarURL() || int.user.defaultAvatarURL
                    })
                    .setThumbnail(u.avatarURL() || u.defaultAvatarURL)
                    .setFooter({
                        text: `ID: ${id}`
                    })
                    .setTimestamp();
        const reply = await int.reply({
            embeds: [emb]
        });

        const msg = await reply.fetch();
        await msg.react(this.thumbUp);
        await msg.react(this.thumbDown);
        //await msg.react()
        const act: InviteAct = {
            start: msg.createdTimestamp,
            length: 36e5 * hrs,
            title: 'invite proposal',
            user: int.user.displayName,
            icon: int.user.avatarURL() || int.user.defaultAvatarURL,
            userId: user.toString(),
            channel: msg.channelId,
            msg: msg.id,
            id
        }
        this.acts.push(act);
        await this.write();
        await this.action(act);

        if (ridicule) await int.followUp({
            content: 'come on add an actual number of hours next time',
            ephemeral: true
        });
        this.ids.set(id, act);
        return id;
    }
}
