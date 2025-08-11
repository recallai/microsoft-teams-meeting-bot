import { Browser, chromium, Page } from 'playwright';
import { Logger } from '../lib/Logger';
import { JoinProcedure } from './join-procedure';
import { CaptionsProcedure } from './captions-procedure';
import z from 'zod';

const OrchestratorStateSchema = z.object({
    botId: z.string().uuid(),
    meetingUrl: z.string(),
    notifierUrls: z.string().array(),
    statusChanges: z.array(
        z.object({
            status: z.enum([
                'unknown',
                'initializing',
                'launching',
                'joining',
                'in_waiting_room',
                'in_call_not_recording',
                'call_ended',
                'done',
                'fatal'
            ]),
            subCode: z.string().nullable(),
            message: z.string().nullable(),
            createdAt: z.string().datetime(),
        })
    )
});
type OrchestratorStateType = z.infer<typeof OrchestratorStateSchema>;

/**
 * The orchestrator initiates the bot's processes and manages the bot's lifecycle/state.
 * 
 * The orchestrator is responsible for:
 * 1. Starting the join flow
 * 2. Starting the captions flow
 * 3. Managing the bot's state
 */
export class Orchestrator {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private logger: Logger;
    public state: OrchestratorStateType = { botId: 'undefined', meetingUrl: '', notifierUrls: [], statusChanges: [] };

    public joinProcedure: JoinProcedure | null = null;
    public captionsProcedure: CaptionsProcedure | null = null;

    /** Initializes the orchestrator state */
    constructor(args: { meetingUrl: string, notifierUrls: string[], botId: string }) {
        this.state = OrchestratorStateSchema.parse({
            botId: args.botId,
            meetingUrl: args.meetingUrl,
            notifierUrls: args.notifierUrls,
            statusChanges: [{
                status: 'initializing',
                subCode: null,
                message: null,
                createdAt: new Date().toISOString()
            }]
        });
        this.logger = new Logger({ source: 'orchestrator', botId: this.state.botId });
    }

    /** Helper method to add a status change to the state */
    private _addStatusChange(statusChange: Partial<Omit<OrchestratorStateType['statusChanges'][number], 'createdAt'>>) {
        this.state = OrchestratorStateSchema.parse({
            ...this.state,
            statusChanges: [
                ...this.state.statusChanges,
                {
                    // Prefill/override the status, subCode and message from the status change
                    status: 'unknown' as const,
                    subCode: null,
                    message: null,
                    ...statusChange,
                    // Don't override the createdAt
                    createdAt: new Date().toISOString()
                }
            ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        });
    }

    /** Initialize the playwright browser and page */
    private async _initializeBrowser() {
        try {
            this.browser = await chromium.launch({
                headless: process.env.NODE_ENV === 'production' ? true : false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--use-fake-ui-for-media-stream',
                    '--use-fake-device-for-media-stream',
                ],
            });
            const context = await this.browser.newContext({
                viewport: { width: 1280, height: 720 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            });
            this.page = await context.newPage();
            this._addStatusChange({ status: 'launching', subCode: null, message: null });
            this.logger.info({ message: 'Browser launched', data: this.state });
        } catch (error) {
            this._addStatusChange({ status: 'fatal', subCode: null, message: null });
            this.logger.error({ message: 'Error launching browser', data: { state: this.state, error } });
            throw error;
        }
    }

    /** Starts the join meeting procedure */
    private async _joinMeeting() {
        if (!this.page) {
            throw new Error('Browser not launched, Orchestrator._initialize() might have failed');
        }

        this._addStatusChange({ status: 'joining', subCode: null, message: null });

        if (!this.joinProcedure) {
            this.joinProcedure = new JoinProcedure({ page: this.page, botId: this.state.botId });
        }
        await this.joinProcedure.startMeetingLauncherFlow({ meetingUrl: this.state.meetingUrl });
        await this.joinProcedure.joinMeetingLobbyFlow();

        if (await this.joinProcedure.isInMeetingLobby({ waitForSeconds: 10 })) {
            this._addStatusChange({ status: 'in_waiting_room', subCode: null, message: 'Bot entered the meeting lobby.' });
        }

        // Wait for 1 minute for the host to let the bot in.
        if (await this.joinProcedure.isInMeeting({ waitForSeconds: 15 })) {
            this._addStatusChange({ status: 'in_call_not_recording', subCode: null, message: 'Bot entered the meeting.' });
        } else {
            this._addStatusChange({ status: 'fatal', subCode: 'unknown_page', message: 'Bot is on an unknown page.' });
            throw new Error('Bot is on an unknown page.');
        }

        this._addStatusChange({ status: 'done', subCode: null, message: null })
    }

    /**
     * Starts the captions subscription procedure.
     */
    private async _subscribeToCaptions() {
        if (!this.page) {
            throw new Error('Browser not launched, Orchestrator._initialize() might have failed');
        }

        if (!this.captionsProcedure) {
            this.captionsProcedure = new CaptionsProcedure({
                page: this.page,
                botId: this.state.botId,
                notifierUrls: this.state.notifierUrls,
            });
        }
        await this.captionsProcedure.enableCaptionsFlow();
        await this.captionsProcedure.subscribeToCaptions();

        this._addStatusChange({ status: 'done', subCode: null, message: null })
    }

    /** Closes the playwright browser and logs the bot out of the meeting. */
    private async _close() {
        this.logger.info({ message: 'Attempting to close browser and log out of meeting if in meeting.', data: this.state });

        if (!this.page || !this.browser) {
            throw new Error('Browser not launched, Orchestrator._initialize() might have failed');
        }

        if (!this.joinProcedure) {
            this.joinProcedure = new JoinProcedure({ page: this.page, botId: this.state.botId });
        }

        if (await this.joinProcedure.isInMeeting({ waitForSeconds: 10 })) {
            await this.joinProcedure.leaveMeetingFlow();
            this._addStatusChange({ status: 'call_ended', subCode: null, message: 'Bot left the meeting.' });
        }

        await this.browser.close();

        this._addStatusChange({ status: 'done', subCode: null, message: 'Browser closed' });

        this.logger.info({ message: 'Browser closed', data: this.state });

        // Close the connection to the log file
        this.logger.close();
    }

    /**
     * ================================================
     * Public methods
     * ================================================
     */

    /**
     * The main entry point for the orchestrator.
     * This method will launch the browser and start the join meeting procedure.
     * It will also maintain the bot's status changes throughout the bot lifecycle
     */
    public async launch() {
        try {
            await this._initializeBrowser();
            await this._joinMeeting();

            // These set of automations run in parallel after the bot has joined the meeting.
            await this._subscribeToCaptions();

        } catch (error) {
            this._addStatusChange({ status: 'fatal', message: 'Bot failed to launch.' });
            throw error;
        }
    }

    public async getCaptions() {
        if (!this.captionsProcedure) {
            throw new Error('Captions procedure not initialized, Orchestrator._initialize() might have failed');
        }

        return this.captionsProcedure.state.captions;
    }

    public async shutdown() {
        await this._close();
    }
} 