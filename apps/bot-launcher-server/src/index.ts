import express from 'express';
import bodyParser from 'body-parser';
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
import { WebSocketServer } from 'ws';
import Docker from 'dockerode';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const app = express();
app.use(bodyParser.json());

// ================
// Bot Launcher API
// ================

app.post('/api/bot', async (req, res) => {
    const validation = z.object({
        port: z.number().default(Math.floor(Math.random() * 100) + 4100),
        meetingUrl: z.string().url(),
        notifierUrls: z.array(z.string()).default([]),
        botId: z.string().uuid().default(crypto.randomUUID()),
    }).safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
    }

    const { port, meetingUrl, notifierUrls, botId } = validation.data;

    const env = [
        `NODE_ENV=production`,
        `PORT=${port}`,
        `MEETING_URL=${meetingUrl}`,
        `NOTIFIER_URLS=${notifierUrls.join(',')}`,
        `BOT_ID=${botId}`,
    ];

    try {
        console.log(`Attempting to start bot container for botId: ${botId}. config: ${JSON.stringify(env)}`);

        const dockerNetworkName = process.env.DOCKER_NETWORK || 'client-dev-network';

        await docker.createContainer({
            Image: 'teams-bot:latest',
            Env: env,
            name: `teams-bot-${botId}`,
            HostConfig: {
                PortBindings: {
                    [`${port}/tcp`]: [{ HostPort: `${port}` }]
                },
                NetworkMode: dockerNetworkName
            }
        }).then(container => container.start());

        console.log(`Successfully started bot container for botId: ${botId}`);
        res.status(202).json({
            message: 'Bot container started successfully',
            botId: botId,
            port: port,
            containerName: `teams-bot-${botId}`
        });

    } catch (error: any) {
        console.error(`Failed to start bot container for botId: ${botId}`, error);
        res.status(500).json({
            message: 'Failed to start bot container',
            error: error.message
        });
    }
});

// ================
// Webhook Endpoint
// ================
app.post('/api/wh/bot', (req, res) => {
    console.log(`Received webhook message. data=${JSON.stringify(req.body)}`);
    res.status(200).send('Webhook received');
});

// ============
// WebSocket Endpoint
// ============
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
    console.log('Client connected to /api/ws/bot');
    ws.on('message', (message) => {
        console.log('Received websocket message:', message.toString());
        ws.send(`Echo: ${message.toString()}`);
    });
    ws.on('close', () => console.log('Client disconnected from /api/ws/bot'));
    ws.on('error', (error) => console.error('WebSocket error:', error));
});

server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
    if (pathname === '/api/ws/bot') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// ============
// Server Setup
// ============
const PORT = process.env.BOT_LAUNCHER_SERVER_PORT || 4100;

server.listen(PORT, () => {
    console.log(`Bot launcher server running on port ${PORT}`);
});
