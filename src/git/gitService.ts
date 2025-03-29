import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';
import { config } from '../config';
import { logger } from '../utils/logger';
import path from 'path';

const options: Partial<SimpleGitOptions> = {
    baseDir: config.OBSIDIAN_VAULT_PATH,
    binary: 'git',
    maxConcurrentProcesses: 6,
    trimmed: false,
};

const git: SimpleGit = simpleGit(options);

let isGitOperationRunning = false; // Simple mutex flag
let pullIntervalId: NodeJS.Timeout | number | null = null;

export async function pullChanges(): Promise<void> {
    if (isGitOperationRunning) {
        logger.warn('[Git] Operation already in progress, skipping pull.');
        return;
    }
    isGitOperationRunning = true;
    logger.info('[Git] Pulling changes from remote...');
    try {
        // Check for local changes before pulling to avoid conflicts with auto-pull
        const status = await git.status();
        if (status.files.length > 0 && !status.isClean()) {
            logger.warn('[Git] Local changes detected before pull. Stashing...');
            // Basic stash - more complex conflict resolution might be needed
            await git.stash(['push', '-u', '-m', `obsidian-bot-autostash-${Date.now()}`]);
            logger.info('[Git] Changes stashed.');
        }

        const pullResult = await git.pull({ '--rebase': 'false' }); // Use merge strategy
        if (pullResult.summary.changes || pullResult.summary.insertions || pullResult.summary.deletions) {
            logger.info('[Git] Pull successful.', pullResult.summary);
        } else {
            logger.info('[Git] Pull successful. No changes detected.');
        }
         // Attempt to pop stash if one was created
        // This is basic, might fail if pull had conflicts with stash
        try {
            const stashList = await git.stash(['list']);
            if (stashList && stashList.includes('obsidian-bot-autostash')) { // Check if our stash exists
                 logger.info('[Git] Applying stashed changes after pull...');
                 await git.stash(['pop']);
                 logger.info('[Git] Stash pop successful.');
            }
        } catch (stashError: any) {
             logger.error('[Git] Failed to pop stash after pull. Manual intervention might be required.', stashError);
             // Notify admin/user?
        }


    } catch (error: any) {
        logger.error('[Git] Pull failed:', { error: error.message, stdout: error.stdout, stderr: error.stderr });
        // Potentially notify admin/user about pull failure
        // throw error; // Decide if failure should halt operations or just be logged
    } finally {
        isGitOperationRunning = false;
    }
}

// Function to add, commit, and push changes
export async function commitAndPush(filePaths: string[], commitMessage: string): Promise<void> {
     if (isGitOperationRunning) {
        logger.warn('[Git] Operation already in progress, skipping commit/push. Will be picked up later.');
        // The changes are saved locally, they will be committed in a future operation
        return;
        // OR: Implement a queue/retry mechanism for git operations
    }
    isGitOperationRunning = true;
    logger.info(`[Git] Committing and pushing changes for: ${filePaths.map(p => path.basename(p)).join(', ')}`);

    try {
        // It's often safer to pull right before pushing to minimize merge issues
        // However, periodic pull should handle this. Let's rely on that for now to simplify.
        // Optional: await pullChanges(); // Uncomment if you want pull before every push

        // Stage the specific files
        // Convert absolute paths back to relative paths from the vault root for git add
        const relativePaths = filePaths.map(fp => path.relative(config.OBSIDIAN_VAULT_PATH, fp));
        logger.debug(`[Git] Staging files: ${relativePaths.join(', ')}`);
        await git.add(relativePaths);

        // Check if there are staged changes before committing
        const status = await git.status();
        if (status.staged.length === 0) {
            logger.warn('[Git] No changes staged, skipping commit and push.');
            isGitOperationRunning = false;
            return;
        }

        // Commit
        logger.info(`[Git] Committing with message: "${commitMessage}"`);
        const commitResult = await git.commit(commitMessage);
        logger.info(`[Git] Commit successful: ${commitResult.commit}`);

        // Push
        logger.info('[Git] Pushing changes to remote...');
        await git.push(); // Assumes default remote 'origin' and branch configured upstream
        logger.info('[Git] Push successful.');

    } catch (error: any) {
        logger.error('[Git] Commit/Push failed:', { error: error.message, stdout: error.stdout, stderr: error.stderr });
        // Rethrow to be caught by task processor for user notification
        throw new Error(`Git operation failed: ${error.message}`);
    } finally {
        isGitOperationRunning = false;
    }
}

// Function to start periodic Git pull
export function startPeriodicGitPull(): void {
    if (pullIntervalId) {
        logger.warn('[Git] Periodic pull already running.');
        return;
    }
    if (config.GIT_PULL_INTERVAL_MS > 0) {
        logger.info(`[Git] Starting periodic pull every ${config.GIT_PULL_INTERVAL_MS / 1000} seconds.`);
        // Initial pull on startup after a short delay
        setTimeout(() => {
            pullChanges().catch(e => logger.error('[Git] Initial pull failed:', e));
        }, 5000);

        pullIntervalId = setInterval(async () => {
            await pullChanges();
        }, config.GIT_PULL_INTERVAL_MS);
    } else {
         logger.info('[Git] Periodic pull disabled (GIT_PULL_INTERVAL_MS is 0 or not set).');
    }
}

// Function to stop periodic Git pull
export function stopPeriodicGitPull(): void {
    if (pullIntervalId) {
        logger.info('[Git] Stopping periodic pull.');
        clearInterval(pullIntervalId);
        pullIntervalId = null;
    }
}