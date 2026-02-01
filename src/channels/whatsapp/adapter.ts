import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { useEncryptedAuthState } from './encrypted-auth.js';
import { Boom } from '@hapi/boom';
import path from 'node:path';
import fs from 'node:fs';
import { Channel, InboundMessage, OutboundMessage } from '../types.js';
import { logger } from '../../utils/logger.js';

import qrcode from 'qrcode-terminal';

export class WhatsAppChannel implements Channel {
    public id = 'whatsapp';
    private socket: any;
    private handler?: (msg: InboundMessage) => void;
    private dataDir: string;
    private phoneNumber?: string;
    private authorizedJids: string[];

    constructor(dataDir: string, phoneNumber?: string, authorizedJids: string[] = []) {
        this.dataDir = path.join(dataDir, 'whatsapp-auth');
        this.phoneNumber = phoneNumber;
        this.authorizedJids = authorizedJids;
    }

    onMessage(handler: (msg: InboundMessage) => void) {
        this.handler = handler;
    }

    updateConfig(config: any) {
        if (config.phoneNumber) {
            this.phoneNumber = config.phoneNumber;
        }
        if (config.authorizedJids) {
            this.authorizedJids = config.authorizedJids;
            logger.info(`WhatsApp authorized JIDs updated: ${this.authorizedJids.length} entries`);
        }
    }

    async start() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        const { state, saveCreds } = await useEncryptedAuthState(this.dataDir);
        const { version } = await fetchLatestBaileysVersion();

        // Fix: makeWASocket is the default export, but in some ESM environments 
        // it might be under .default or direct.
        const makeSocket = (makeWASocket as any).default || makeWASocket;
        this.socket = makeSocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger as any),
            },
            logger: logger as any,
        });

        // Handle Pairing Code
        if (this.phoneNumber && !this.socket.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    const code = await this.socket.requestPairingCode(this.phoneNumber);
                    console.log('\n--- WHATSAPP PAIRING CODE ---');
                    console.log(`Your pairing code is: ${code}`);
                    console.log('Enter this code on your phone in: Linked Devices > Link with phone number');
                    console.log('--- END PAIRING CODE ---\n');
                } catch (err: any) {
                    logger.error(`Failed to request pairing code: ${err.message}`);
                }
            }, 3000); // Wait a bit for the socket to be ready
        }

        this.socket.ev.on('creds.update', saveCreds);

        this.socket.ev.on('connection.update', (update: any) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr && (!this.phoneNumber || this.socket.authState.creds.registered)) {
                console.log('\n--- WHATSAPP QR CODE ---');
                logger.info('WhatsApp QR Code received, scan it with your phone:');
                qrcode.generate(qr, { small: true });
                console.log('--- END QR CODE ---\n');
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                logger.info('WhatsApp connection closed, reconnecting: ' + shouldReconnect);
                if (shouldReconnect) {
                    this.start();
                }
            } else if (connection === 'open') {
                logger.info('WhatsApp connection opened');
            }
        });

        this.socket.ev.on('messages.upsert', async (m: any) => {
            if (m.type === 'notify') {
                for (const msg of m.messages) {
                    if (!msg.key.fromMe && msg.message?.conversation) {
                        const remoteJid = msg.key.remoteJid;
                        if (this.authorizedJids.length > 0 && remoteJid && !this.authorizedJids.includes(remoteJid)) {
                            logger.warn(`Unauthorized WhatsApp message from: ${remoteJid}`);
                            continue;
                        }
                        if (this.handler) {
                            this.handler({
                                id: msg.key.id!,
                                sessionKey: `whatsapp:${msg.key.remoteJid}`,
                                text: msg.message.conversation,
                                channelId: this.id,
                            });
                        }
                    }
                }
            }
        });
    }

    async stop() {
        if (this.socket) {
            this.socket.end();
            logger.info('WhatsApp socket closed');
        }
    }

    async sendMessage(msg: OutboundMessage) {
        const jid = msg.sessionKey.split(':')[1];
        await this.socket.sendMessage(jid, { text: msg.text });
    }
}
