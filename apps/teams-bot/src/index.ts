import { Logger } from './lib/Logger';
import { z } from 'zod';
import { Orchestrator } from './procedures/orchestrator';
import express from 'express';

const envSchema = z.object({
    MEETING_URL: z.string().url(),
    BOT_ID: z.string().uuid(),
    PORT: z.coerce.number(),
    NOTIFIER_URLS: z.preprocess(
        (val) => !!val && typeof val === 'string' ? val.split(',').map(url => url.trim()) : undefined,
        z.array(z.string().url()).default([])
    ),
});

const env = envSchema.parse(process.env);

const main = async () => {
    const { MEETING_URL, BOT_ID, NOTIFIER_URLS, PORT } = env;

    // If the bot is not launched with the required environment variables, it will not start.
    // This is to prevent the bot from starting automatically in a development environment.
    if (!MEETING_URL || !BOT_ID) {
        console.log('Bot is not configured to start. Missing one or more environment variables: MEETING_URL, BOT_ID');
        return;
    }

    const logger = new Logger({ source: 'bot-runner', botId: BOT_ID });
    let bot: Orchestrator | null = null;

    try {
        logger.info({ message: 'Bot process started', data: { botId: BOT_ID, meetingUrl: MEETING_URL, notifierUrls: NOTIFIER_URLS } });

        bot = new Orchestrator({
            meetingUrl: MEETING_URL,
            notifierUrls: NOTIFIER_URLS,
            botId: BOT_ID,
        });

        // Launch the bot in the background
        bot.launch();

        logger.info({ message: 'Bot has deployed and is starting to join the meeting' });
    } catch (error) {
        logger.error({ message: 'Bot process failed during startup', data: error });
        process.exit(1);
    }

    const app = express();

    app.get('/captions', async (req, res) => {
        if (!bot) {
            return res.status(503).json({ error: 'Bot not initialized' });
        }
        try {
            const captions = await bot.getCaptions();
            res.json({ captions });
        } catch (error) {
            logger.error({ message: 'Error getting captions', data: error });
            res.status(500).json({ error: 'Failed to get captions' });
        }
    });

    app.listen(PORT, () => {
        logger.info({ message: `Server listening on port ${PORT}` });
    });
}

main();
