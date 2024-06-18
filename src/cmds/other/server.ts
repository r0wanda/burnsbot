import os from 'node:os';
import { readFile as rf, access } from 'node:fs/promises';
import { constants as fsconst } from 'node:fs';
import { CommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { GenericCmdInstance } from "../../index.js";

export default class Server implements GenericCmdInstance {
    data: SlashCommandBuilder;
    start: number;
    constructor() {
        this.data = new SlashCommandBuilder()
                    .setName('server')
                    .setDescription('check bot server status');
        this.start = Date.now();
    }
    uptime(sec = os.uptime()) {
        let min = sec / 60;
        let hr = min / 60;
        let day = hr / 24;
        min = Math.floor(min) % 60;
        hr = Math.floor(hr) % 60;
        day = Math.floor(day) % 24;
        return `${day ? `${day} days, ` : ''}${day || hr ? `${hr} hours, and ` : ''}${hr || min ? `${min} minutes` : ''}` || (sec ? `${sec} seconds` : 'not available');
    }
    setUptime(up: number) {
        this.start = up;
    }
    async totalCpu() {
        try {
            await access('/proc/stat', fsconst.F_OK | fsconst.R_OK);
            let s = await rf('/proc/stat', 'utf8');
            let c: string[] = [];
            for (const l of s.split('\n')) {
                if (l.startsWith('cpu ')) {
                    c = l.replace(/^cpu  /, '').split(' ');
                }
            }
            if (c.length != 10) throw null;
            const usr = +c[0],
                nice = +c[1],
                sys = +c[2],
                idl = +c[3],
                io = +c[4],
                irq = +c[5],
                sirq = +c[6],
                stel = +(c[7] || 0),
                gst = +(c[8] || 0),
                gstn = +(c[9] || 0);
            let u = (idl * 100) / (usr + nice + sys + idl + io + irq + sirq + stel + gst + gstn);
            u = 100 - u;
            return `${+u.toFixed(2)}%`
        } catch {
            return 'not available';
        }
    }
    formatBytes(bytes: number, decimals = 2) {
        // https://stackoverflow.com/a/18650828
        if (bytes < 1) return '0 Bytes';
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(dm))} ${sizes[i]}`;
    }
    getRam() {
        const used = os.totalmem() - os.freemem();
        return `${this.formatBytes(used)} (${+(100 * used / os.totalmem()).toFixed(2)}%)`;
    }
    async exec(int: CommandInteraction) {
        const emb = new EmbedBuilder()
                    .setColor(0x2a54d3)
                    .setTitle('server status')
                    .addFields([
                        {
                            name: 'server uptime',
                            value: this.uptime()
                        },
                        {
                            name: 'bot uptime',
                            value: this.uptime(Math.floor((Date.now() - this.start) / 1000))
                        },
                        {
                            name: 'cpu usage',
                            value: await this.totalCpu()
                        },
                        {
                            name: 'ram usage',
                            value: this.getRam()
                        }
                    ]);
        await int.reply({
            embeds: [emb]
        })
    }
}
