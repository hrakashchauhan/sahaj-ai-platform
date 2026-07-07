import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { verifyMetaSignature } from './signature';
import { inboundQueue } from '../queue/queues';

/**
 * Front door for all Meta channels (WhatsApp / Instagram / GBM).
 * CRITICAL: verify signature, ENQUEUE, and return 200 in <1s. No product work here —
 * Meta retries aggressively and de-lists slow endpoints.
 */
@Controller('webhooks')
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  // GET /webhooks/whatsapp — Meta verification handshake.
  @Get(':provider')
  verify(@Query() q: Record<string, string>, @Res() res: Response) {
    const mode = q['hub.mode'];
    const token = q['hub.verify_token'];
    const challenge = q['hub.challenge'];
    if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('forbidden');
  }

  // POST /webhooks/whatsapp — inbound events.
  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    if (env.META_APP_SECRET) {
      const ok = verifyMetaSignature(
        req.rawBody ?? Buffer.from(''),
        req.header('x-hub-signature-256'),
        env.META_APP_SECRET,
      );
      if (!ok) {
        this.logger.warn('Rejected webhook: invalid signature');
        return { status: 'invalid-signature' };
      }
    }
    await inboundQueue.add('event', { provider, body: req.body });
    return { status: 'ok' };
  }
}
