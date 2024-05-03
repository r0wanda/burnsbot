import { SlashCommandBuilder, hyperlink, type CommandInteraction } from "discord.js";

export default class Ping {
    data: SlashCommandBuilder;
    constructor() {
        this.data = new SlashCommandBuilder();
        this.data.setName('ping');
        this.data.setDescription('ping pong');
    }
    async exec(int: CommandInteraction) {
        await int.reply(hyperlink('pong', 'https://scratch.mit.edu/projects/903910265/'));
    }
}