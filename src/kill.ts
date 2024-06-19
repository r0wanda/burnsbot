import { config } from 'dotenv';
import wait from './Netstat.js';
import Server from './Server.js';

config();
if (!process.env.MAINPID) process.exit(1);
process.kill(parseInt(process.env.MAINPID), 'SIGTERM');
if (!process.env.OTHER_IP) process.exit(0);
await wait(process.env.DEVICE_TYPE === 'rpi' ? 50 : 10);
new Server(process.env.OTHER_IP);
await Server.shut(process.env.OTHER_IP);
process.exit(0);