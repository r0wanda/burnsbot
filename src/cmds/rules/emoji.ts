import { EmbedBuilder } from "discord.js";
import { SlashCommandBuilder, type CommandInteraction } from "discord.js";
import { randomUUID } from "node:crypto";
import Base, { type Action } from "../../Base.js";

export interface EmojiAct extends Action {
    img: string;
    name: string;
}

export default class Emoji extends Base<EmojiAct> {
    data: SlashCommandBuilder;
    constructor() {
        super('emoji');
        this.setAction(this.action);
        // @ts-ignore
        this.data = new SlashCommandBuilder()
                    .setName('emoji')
                    .setDescription('add an emoji to the server')
                    .addStringOption(opt =>
                        opt.setName('name')
                        .setDescription('the name of the emoji')
                        .setRequired(true))
                    .addAttachmentOption(opt => 
                        opt.setName('image')
                           .setDescription('the emoji image you want to propose')
                           .setRequired(true))
                    .addIntegerOption(opt =>
                        opt.setName('hours')
                           .setDescription('number of hours after which the votes will be finalized')
                    )
    }
    async action(a: EmojiAct) {
        await super.action(a, async (msg) => {
            const e = await this.guild?.emojis.create({
                attachment: a.img,
                name: a.name
            });
            if (!e) throw new Error('emoji not found, but it still could have been added')
            await msg.reply(`${e.toString()} emoji added ${e.toString()}`);
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
        const img = int.options.get('image', true).attachment;
        if (!img) {
            await int.reply({
                content: 'add an image next time maybe?????????????? :angry:',
                ephemeral: true
            });
            return;
        }
        const name = int.options.get('name', true).value;
        if (!name || typeof name !== 'string' || name.length < 2 || name.search(/[^a-z0-9_]/gi) >= 0) {
            await int.reply({
                content: 'emoji name must be at least 2 characters long, can only contain alphanumeric characters (a-z, 0-9) or underscores (_), and must have no spaces',
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
                    .setTitle(`emoji proposal`)
                    .setDescription(`${int.user.displayName} wants to add an emoji to the server`)
                    .addFields([
                        {
                            name: 'voting',
                            value: 'react with :thumbsup: to add the emoji, react :thumbsdown: to deny the addition'
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
                    .setImage(img.url)
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
        const act: EmojiAct = {
            start: msg.createdTimestamp,
            length: 36e5 * hrs,
            title: 'emoji proposal',
            user: int.user.displayName,
            icon: int.user.avatarURL() || int.user.defaultAvatarURL,
            img: img.url,
            name,
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
