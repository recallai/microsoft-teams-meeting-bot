import fs from 'fs';
import path from 'path';

const fileStreams = new Map<string, fs.WriteStream>();

/**
 * FileStreamer is a class that writes data to a file.
 */
export class FileStreamer {
    private streamId: string;
    private fileStream: fs.WriteStream;

    constructor(args: { streamId: string, filePath?: string }) {
        this.streamId = args.streamId;
        if (fileStreams.has(this.streamId)) {
            this.fileStream = fileStreams.get(this.streamId)!;
        } else if (!args.filePath) {
            throw new Error('Existing stream does not exist for streamId and file path is not provided so cannot create a new stream');
        } else {
            const absolutePath = path.resolve(process.cwd(), args.filePath);
            const fileDir = path.dirname(absolutePath);

            if (!fs.existsSync(fileDir)) {
                fs.mkdirSync(fileDir, { recursive: true });
            }

            const stream = fs.createWriteStream(absolutePath, { flags: 'a' });
            this.fileStream = stream;
            fileStreams.set(this.streamId, stream);

            this.fileStream.on('error', (error) => {
                console.error('Error writing to file stream:', error);
            });
        }

    }

    public write(data: unknown): void {
        const message = typeof data === 'string' ? data : JSON.stringify(data);
        this.fileStream.write(`${message}\n`);
    }

    public close(): void {
        if (fileStreams.has(this.streamId)) {
            const stream = fileStreams.get(this.streamId)!;
            stream.end();
            fileStreams.delete(this.streamId);
        } else {
            console.warn(`File stream for streamId ${this.streamId} not found, cannot close.`);
        }
    }
}
