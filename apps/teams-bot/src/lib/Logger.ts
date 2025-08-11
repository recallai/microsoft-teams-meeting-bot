import { FileStreamer } from './FileStreamer';
import path from 'path';

type SourceType =
    | 'orchestrator'
    | 'join-procedure'
    | 'captions-procedure'
    | 'notifier'
    | 'bot-runner'
    | 'file-streamer';

/**
 * Logs a message to console and a log file.
 * Filename naming convention: <timestamp_stream_opened>-<botId>.log
 */
export class Logger {
    private readonly source: SourceType;
    private readonly botId: string;
    private readonly logFile: FileStreamer;

    constructor(args: { source: SourceType, botId: string }) {
        this.source = args.source;
        this.botId = args.botId;
        this.logFile = new FileStreamer({
            streamId: `${this.botId}-logs`,
            filePath: path.join('output', 'logs', `${new Date().toISOString()}-${this.botId}.log`)
        });
    }

    /** Log a message to the console and the log file */
    private _log(level: 'info' | 'error' | 'warn', args: { message: string, data?: unknown }) {
        const { message, data } = args;
        const logMessage = `${new Date().toISOString()} [${level.toUpperCase()}] [botId=${this.botId}, source=${this.source}] ${message}`;

        const dataString = !!data ? JSON.stringify(data) : '';
        this.logFile.write(`${logMessage}${dataString ? ` ${dataString}` : ''}`);

        console[level](`${new Date().toISOString()} [botId=${this.botId}, source=${this.source}] ${message}`, data);
    }

    /** Log an info message to the console and the log file */
    info(args: { message: string, data?: unknown }) {
        this._log('info', args);
    }

    /** Log an error message to the console and the log file */
    error(args: { message: string, data?: unknown }) {
        this._log('error', args);
    }

    /** Log a warning message to the console and the log file */
    warn(args: { message: string, data?: unknown }) {
        this._log('warn', args);
    }

    /** Close the log stream to the log file for the bot */
    close() {
        this.logFile.close();
    }
}
