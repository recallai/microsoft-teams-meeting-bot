import { WebSocket } from 'ws';
import { Logger } from './Logger';

const wsConnections = new Map<string, WebSocket>();

// Helper function for async delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class Notifier {
    private logger: Logger;
    private urls: string[];

    constructor(args: { urls: string[], botId: string }) {
        this.logger = new Logger({ source: 'notifier', botId: args.botId });
        this.urls = args.urls;
    }

    public async sendEventToServer(args: { payload: unknown }): Promise<void> {
        for (const url of this.urls) {
            try {
                const protocol = new URL(url).protocol;
                this.logger.info({ message: `Sending event to server. endpoint="${url}"` });

                if (protocol === 'http:' || protocol === 'https:') {
                    await this._sendHttp({ url, payload: args.payload });
                } else if (protocol === 'ws:' || protocol === 'wss:') {
                    await this._sendWsWithRetry({ url, payload: args.payload });
                } else {
                    this.logger.error({ message: `Unsupported protocol: ${protocol}` });
                }
            } catch (error) {
                this.logger.error({ message: `Failed to send event to ${url}`, data: error });
            }
        }
    }

    private async _sendHttp(args: { url: string, payload: unknown }): Promise<void> {
        try {
            const response = await fetch(args.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args.payload),
            });

            if (!response.ok) {
                this.logger.warn({ message: `HTTP request to ${args.url} failed with status ${response.status}` });
            }
        } catch (error) {
            this.logger.error({ message: `Error sending HTTP request to ${args.url}`, data: error });
        }
    }

    private async _sendWsWithRetry(args: { url: string; payload: unknown; retries?: number }): Promise<void> {
        const { url, payload, retries = 5 } = args;
        let attempt = 0;

        while (attempt < retries) {
            try {
                const ws = await this._getOrCreateWsConnection(url);
                ws.send(JSON.stringify(payload));
                this.logger.info({ message: `Successfully sent message to ${url}` });
                return; // Success, exit the loop
            } catch (error: any) {
                attempt++;
                this.logger.warn({ message: `Attempt ${attempt} failed for ${url}: ${error.message}` });
                if (attempt < retries) {
                    const backoff = Math.pow(2, attempt) * 100; // Exponential backoff
                    this.logger.info({ message: `Retrying in ${backoff}ms...` });
                    await delay(backoff);
                } else {
                    this.logger.error({ message: `All ${retries} attempts to connect to ${url} failed.` });
                    throw error; // Rethrow after final attempt
                }
            }
        }
    }

    private _getOrCreateWsConnection(url: string): Promise<WebSocket> {
        const existingWs = wsConnections.get(url);
        if (existingWs && existingWs.readyState === WebSocket.OPEN) {
            return Promise.resolve(existingWs);
        }

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);

            const onError = (error: Error) => {
                wsConnections.delete(url);
                ws.close();
                reject(error);
            };

            ws.on('open', () => {
                this.logger.info({ message: `WebSocket connection established to ${url}` });
                wsConnections.set(url, ws);
                // Clean up error listener once connected
                ws.removeListener('error', onError);
                resolve(ws);
            });

            ws.on('error', onError);

            ws.on('close', () => {
                this.logger.info({ message: `WebSocket connection closed for ${url}` });
                wsConnections.delete(url);
            });
        });
    }
}
