import { Page } from 'playwright';
import { Logger } from '../lib/Logger';
import z from 'zod';
import { expect } from '@playwright/test';

const JoinProcedureStateSchema = z.object({
    /** The bot id */
    botId: z.string().uuid(),

    /** A list of status changes that occurred during the join procedure */
    statusChanges: z.array(
        z.object({
            status: z.enum(['unknown', 'initializing', 'joining', 'in_waiting_room', 'joined', 'fatal']),
            subCode: z.string().nullable(),
            message: z.string().nullable(),
            createdAt: z.string().datetime(),
        })
    )
})
type JoinProcedureStateType = z.infer<typeof JoinProcedureStateSchema>;

/**
 * JoinProcedure is a class that handles the join flow for the bot.
 * 
 * There are several different flows:
 * 1. Start the meeting launcher - this starts the meeting from the meeting url
 * 2. Join the meeting lobby - the bot can end up in the waiting room while waiting to be let in by the host
 * 3. Join the meeting room - the bot joins the meeting
 * 4. Leave the meeting room - the bot leaves the meeting
 */
export class JoinProcedure {
    private readonly page: Page;
    private readonly logger: Logger;
    public state: JoinProcedureStateType;

    constructor(args: {
        botId: string,
        page: Page,
    }) {
        this.page = args.page;
        this.state = JoinProcedureStateSchema.parse({
            botId: args.botId,
            statusChanges: [{
                status: 'initializing',
                subCode: null,
                message: null,
                createdAt: new Date().toISOString()
            }]
        });
        this.logger = new Logger({ source: 'join-procedure', botId: args.botId });
    }

    /** Helper method to add a status change to the procedure state */
    private _addStatusChange(statusChange: Partial<Omit<JoinProcedureStateType['statusChanges'][number], 'createdAt'>>) {
        this.state = JoinProcedureStateSchema.parse({
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

    /**
     * Resolve the meeting URL. This will redirect to the meeting launcher.
     * This is necessary because the meeting URL first opens up to the teams launcher which prompts the user to open the meeting in-app.
     * Playwright can't handle the dialog popup because it's outside of the browser context so we need to resolve the redirect to the meeting launcher.
     * Once we get the meeting launcher URL, we can override the search params that causes the dialog popup to appear.
     */
    private async _resolveLaunchUrlWithoutDialog(args: { meetingUrl: string }): Promise<URL | null> {
        const { meetingUrl } = z.object({ meetingUrl: z.string().url(), }).parse(args);

        try {
            const response = await fetch(meetingUrl, { redirect: 'follow' });
            const launchUrl = new URL(response.url);
            launchUrl.searchParams.set('msLaunch', 'false');
            launchUrl.searchParams.set('type', 'meetup-join');
            launchUrl.searchParams.set('directDl', 'true');
            launchUrl.searchParams.set('enableMobilePage', 'true');
            launchUrl.searchParams.set('suppressPrompt', 'true');
            this.logger.info({ message: 'Redirect resolved', data: { meetingUrl: launchUrl.toString() } });

            return launchUrl;
        } catch (error) {
            this._addStatusChange({ status: 'fatal', subCode: 'resolve_redirect_error', message: null });
            this.logger.error({ message: 'Error resolving redirect', data: error });
            return null;
        }
    }

    /**
     * ================================================
     * Public methods
     * ================================================
     */


    /**
     * Opens the meeting launcher from a fresh tab.
     * After completing this page/function, the bot will enter the meeting lobby and attempt to join the meeting.
     */
    async startMeetingLauncherFlow(args: { meetingUrl: string }) {
        const { meetingUrl } = z.object({ meetingUrl: z.string().url(), }).parse(args);

        // From the meeting URL, we meed to get the launch URL that takes us to the meeting lobby.
        const launchUrl = await this._resolveLaunchUrlWithoutDialog({ meetingUrl });
        if (!launchUrl) {
            this._addStatusChange({ status: 'fatal', subCode: 'unresolvable_launch_url', message: "Unable to resolve launch URL from meeting URL" });
            throw new Error('Unable to resolve launch URL from meeting URL');
        }

        try {
            await this.page.goto(launchUrl.toString());
            const continueButtonSelector = 'button[data-tid="joinOnWeb"]';
            await this.page.waitForSelector(continueButtonSelector, { timeout: 30000 });
            this.logger.info({ message: 'Found "Continue on this browser" button.' });
            await this.page.click(continueButtonSelector);
            this.logger.info({ message: 'Clicked "Continue on this browser" button.' });
        } catch (error) {
            this._addStatusChange({ status: 'fatal', subCode: null, message: null });
            this.logger.error({ message: 'Error clicking "Continue on this browser"', data: error });
            throw error;
        }
    }

    /** Bot attempts to join the meeting or enter the waiting room */
    public async joinMeetingLobbyFlow() {
        try {
            this._addStatusChange({ status: 'joining', message: 'Starting to join meeting lobby...' });

            const nameInputSelector = 'input[placeholder="Type your name"]';
            await this.page.waitForSelector(nameInputSelector, { timeout: 15000 });
            await this.page.fill(nameInputSelector, 'RecallBot');
            this.logger.info({ message: 'Entered bot name.' });

            const joinNowButtonSelector = 'button:has-text("Join now")';
            await this.page.waitForSelector(joinNowButtonSelector);
            await this.page.click(joinNowButtonSelector);
            this.logger.info({ message: 'Clicked "Join now" button.' });
        } catch (error) {
            this._addStatusChange({ status: 'fatal', subCode: null, message: null });
            this.logger.warn({
                message: 'Could not complete the final join steps.',
                data: error,
            });
            throw error;
        }
    }

    /** Check if the current page is the meeting lobby */
    public async isInMeetingLobby(args: { waitForSeconds?: number }) {
        const { waitForSeconds } = z.object({ waitForSeconds: z.number().optional().default(1) }).parse(args);

        if (waitForSeconds > 1) {
            this.logger.info({ message: 'Checking if bot is in meeting lobby...' });
        }

        try {
            await expect(this.page.getByText('Someone will let you in shortly')).toBeVisible({ timeout: waitForSeconds * 1000 });
            this.logger.info({ message: 'Bot is in meeting lobby, waiting for host to let the bot in.' });

            // Only add the status change if the bot is not already in the waiting room
            if (this.state.statusChanges[this.state.statusChanges.length - 1].status !== 'in_waiting_room') {
                this._addStatusChange({ status: 'in_waiting_room', message: 'Bot is in meeting lobby, waiting for host to let the bot in.' });
            }

            return true;
        } catch (error) {
            this.logger.info({ message: 'Bot is not in meeting lobby.' });
            return false;
        }
    }

    /** Check if the current page is the meeting room */
    public async isInMeeting(args: { waitForSeconds?: number }) {
        const { waitForSeconds } = z.object({ waitForSeconds: z.number().optional().default(1) }).parse(args);

        if (waitForSeconds > 1) {
            this.logger.info({ message: 'Checking if bot is in meeting...' });
        }

        try {
            const leaveButtonSelector = 'button[id="hangup-button"]';
            await this.page.waitForSelector(leaveButtonSelector, { timeout: waitForSeconds * 1000 });
            this.logger.info({ message: 'Bot is in meeting.' });

            // Only add the status change if the bot is not already in the meeting
            if (this.state.statusChanges[this.state.statusChanges.length - 1].status !== 'joined') {
                this._addStatusChange({ status: 'joined', message: 'Bot is in meeting.' });
            }

            return true;
        } catch (error) {
            this.logger.info({ message: 'Bot is not in meeting.' });
            return false;
        }
    }

    /** Bot attempts to leave the meeting. Must be in the meeting lobby to leave. */
    public async leaveMeetingFlow() {
        try {
            const leaveButtonSelector = 'button[id="hangup-button"]';
            await this.page.waitForSelector(leaveButtonSelector);
            await this.page.click(leaveButtonSelector);
        } catch (error) {
            this._addStatusChange({ status: 'fatal', subCode: null, message: null });
            this.logger.warn({
                message: 'Could not leave the meeting.',
                data: error,
            });
            throw error;
        }
    }
} 