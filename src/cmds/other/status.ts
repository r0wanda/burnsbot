import { SlashCommandBuilder, Collection, type CommandInteraction, EmbedBuilder } from "discord.js";
import Base, { type Action } from '../../Base.js';
import type { GenericCmdInstance } from "../../index.js";

export default class Status implements GenericCmdInstance {
    data: SlashCommandBuilder;
    ids?: Collection<string, Base<Action>>;
    constructor() {
        // @ts-ignore
        this.data = new SlashCommandBuilder()
                    .setName('status')
                    .setDescription('check the status of a vote/proposal')
                    .addStringOption(opt =>
                        opt.setName('id')
                           .setDescription('the command id')
                           .setRequired(true));
    }
    setIds(ids: typeof this.ids) {
        this.ids = ids;
    }
    async exec(int: CommandInteraction) {
        if (!this.ids) {
            await int.reply({
                content: 'try again in a second',
                ephemeral: true
            });
            return;
        }
        let id = int.options.get('id', true).value;
        if (!id || typeof id !== 'string') {
            await int.reply({
                content: 'invalid id',
                ephemeral: true
            });
            return;
        }
        id = id.toLowerCase().trim();
        const ref = this.ids.get(id);
        const a = ref?.fromId(id);
        if (!ref || !a) {
            await int.reply({
                content: 'invalid id',
                ephemeral: true
            });
            return;
        }
        function msTime(ms: number) {
            const hrs = Math.floor((ms / 36e5) % 24);
            const min = Math.floor((ms / 6e4) % 60);
            if (hrs < 1 && min < 1) return `${Math.floor((ms / 1000) % 60)} seconds`;
            return `${hrs} hours, ${min} minutes`;
        }
        const emb = new EmbedBuilder()
                    .setColor(0x2a54d3)
                    .setTitle(a.title)
                    .setAuthor({
                        name: a.user,
                        iconURL: a.icon
                    })
                    .addFields([
                        {
                            name: 'start time',
                            value: `this vote started at ${new Date(a.start).toString()}`
                        },
                        {
                            name: 'time left',
                            value: `this vote will end in ${msTime(a.length - (Date.now() - a.start))}`
                        }
                    ])
                    .setFooter({
                        text: `ID: ${id}`
                    })
                    .setTimestamp(a.start);
        await int.reply({
            embeds: [emb]
        });
    }
}