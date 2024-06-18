import { config } from 'dotenv';
import Server from './Server.js';

config();
if (!process.env.MAINPID) process.exit(1);
process.kill(parseInt(process.env.MAINPID), 'SIGTERM');
if (!process.env.OTHER_IP) process.exit(0);
await Server.connect(process.env.OTHER_IP);