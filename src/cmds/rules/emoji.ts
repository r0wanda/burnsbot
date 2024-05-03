import { EmbedBuilder, MessageReaction, PartialMessageReaction, PartialUser, TextChannel, User } from "discord.js";
import { SlashCommandBuilder, type CommandInteraction, type Guild } from "discord.js";
import Cache from "../../Cache.js";
import { type FileReadResult } from "node:fs/promises";

export interface Action {
    start: number;
    length: number;
    img: string;
    channel: string;
    msg: string;
    t: number;
}

export default class Emoji extends Cache {
    data: SlashCommandBuilder;
    guild?: Guild;
    cache: FileReadResult<Buffer>;
    acts: Action[];
    constructor() {
        super('emoji', async () => {
            this.cache = await this.fd.read();
            this.acts = JSON.parse(this.cache.buffer.toString('utf8', 0, this.cache.bytesRead));
        });
        this.cache = {
            bytesRead: 0,
            buffer: Buffer.alloc(1)
        }
        this.acts = [];
        // @ts-ignore
        this.data = new SlashCommandBuilder()
                    .setName('emoji')
                    .setDescription('add an emoji to the server')
                    .addAttachmentOption(opt => 
                        opt.setName('image')
                           .setDescription('the emoji image you want to propose')
                           .setRequired(true))
                    .addIntegerOption(opt =>
                        opt.setName('hours')
                           .setDescription('number of hours after which the votes will be finalized')
                    )
    }
    async write() {
        await this.fd.write(JSON.stringify(this.acts), 0);
        this.cache = await this.fd.read({
            position: 0
        });
        if (this.cache.buffer.byteLength > 1) this.acts = JSON.parse(this.cache.buffer.toString('utf8', 0, this.cache.bytesRead));
    }
    async setGuild(guild: Guild) {
        this.guild = guild;
        const prs: Promise<void>[] = [];
        for (const act of this.acts) {
            prs.push(this.action(act));
        }
        await Promise.all(prs);
    }
    async action(a: Action) {
        if (!this.guild) throw new Error('No guild found');
        const _channel = await this.guild.channels.fetch(a.channel);
        if (!_channel) throw new Error('No channel found');
        const channel = await _channel?.fetch();
        if (!channel.isTextBased()) throw new Error('Channel is not text channel');
        const msg = await channel.messages.fetch(a.msg);
        const upd = async (react: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
            if (react.message.id !== msg.id) return;
            if (react.message.reactions) {
                console.log(react.message.reactions);
                const re: { [key: string]: MessageReaction } = {};
                for (const [k, v] of await react.message.awaitReactions({
                    filter: (m, u) => true
                })) {
                    re[k] = v;
                }
                console.log(re)
            }
        }
        this.guild.client.on('messageReactionAdd', upd);
        const i = this.acts.indexOf(a);
        if (i >= 0) this.acts[i].t;
    }
    async exec(int: CommandInteraction) {
        if (!this.guild) {
            await int.reply({
                content: 'hold up, try again in a couple seconds',
                ephemeral: true
            });
            return;
        }
        const img = int.options.get('image', true).attachment;
        if (!img) {
            await int.reply({
                content: 'add an image next time maybe?????????????? :angry:',
                ephemeral: true
            });
            return;
        }
        let rawHrs = int.options.get('hours')?.value ?? '2';
        let hrs = parseInt(rawHrs.toString());
        let ridicule = 0;
        if (isNaN(hrs)) hrs = 2;
        if (hrs < 1 || hrs > 48) ridicule = hrs = 2;

        const emb = new EmbedBuilder()
                    .setColor(0x2a54d3)
                    .setTitle(`emoji proposal`)
                    .setDescription(`${int.user.displayName} is proposing an emoji to be added to the server`)
                    .addFields([
                        {
                            name: 'voting',
                            value: 'react with :thumbsup: to add the emoji, react :thumbsdown: to deny the addition'
                        },
                        {
                            name: 'rules',
                            value: 'if 3/4ths of the server votes yes, it will be put in place 10 minutes afterwards, as long as the votes never drop below 3/4ths\n'
                            + `if a 3/4ths majority is not reached, the majority vote will be chosen in ${hrs} hours`
                        }
                    ])
                    .setAuthor({
                        name: int.user.displayName,
                        iconURL: await int.user.avatarURL() || int.user.defaultAvatarURL
                    })
                    .setImage(img.url);
        const reply = await int.reply({
            embeds: [emb]
        });

        const msg = await reply.fetch();
        await msg.react(this.thumbUp);
        await msg.react(this.thumbDown);
        //await msg.react()
        const act: Action = {
            start: msg.createdTimestamp,
            length: 36e5 * hrs,
            img: img.url,
            channel: msg.channelId,
            msg: msg.id,
            t: -1
        }
        this.acts.push(act);
        await this.write();
        await this.action(act);

        if (ridicule) await int.followUp({
            content: 'come on add an actual number of hours next time',
            ephemeral: true
        })
    }
}