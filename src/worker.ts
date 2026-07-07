import 'reflect-metadata';
import { Worker } from 'bullmq';
import { QUEUES, scheduleQueue, redisConnection } from './queue/queues';
import { handleInboundEvent } from './ingestion/ingestion.service';
import { runPipeline } from './ai/pipeline.worker';
import { processOutbound } from './messaging/outbound.service';
import { runGraduation } from './approvals/graduation.service';
import { startBot } from './approvals/telegram.bot';
import { verifyRlsOrExit } from './db/rls-check';
import { warnMissingProdSecrets } from './config/prod-guard';

/**
 * Message-processing process (separate from the HTTP API in main.ts).
 * Runs the inbound → ai → outbound pipeline + the nightly graduation job +
 * the Telegram approval bot.
 */
async function main() {
  warnMissingProdSecrets();
  await verifyRlsOrExit(); // fail-closed: refuse to boot in prod if RLS can be bypassed

  const base = { connection: redisConnection, concurrency: 8 };

  const workers = [
    new Worker(QUEUES.inbound, async (job) => handleInboundEvent(job.data), base),
    new Worker(QUEUES.ai, async (job) => runPipeline(job.data), base),
    new Worker(QUEUES.outbound, async (job) => processOutbound(job.data), base),
    new Worker(
      QUEUES.schedule,
      async (job) => {
        if (job.name === 'graduation') await runGraduation();
      },
      { connection: redisConnection },
    ),
  ];

  // Nightly auto-send graduation at 02:00 (server tz).
  await scheduleQueue.add('graduation', {}, { repeat: { pattern: '0 2 * * *' }, jobId: 'nightly-graduation' });

  startBot();
  console.log('👷 Sahaj workers running (inbound · ai · outbound · schedule)');

  // Graceful shutdown: let in-flight jobs finish before exit.
  const shutdown = async (sig: string) => {
    console.log(`\n${sig} received — closing workers…`);
    await Promise.allSettled(workers.map((w) => w.close()));
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('Worker failed to start', e);
  process.exit(1);
});
