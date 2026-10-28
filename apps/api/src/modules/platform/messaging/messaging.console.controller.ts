import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import {
  createPlatformWhatsAppSessionSchema,
  idSchema,
  messagingHealthSchema,
  noContentSchema,
  platformWhatsAppSessionListSchema,
  platformWhatsAppSessionSchema,
  whatsappQrSchema,
  whatsappSessionDetailSchema,
} from '@vertex-food/contracts';
import type { z } from 'zod';
import { ConsoleRoute, NoFeature } from '../../../core/access/access.decorators.js';
import { CurrentPlatformUser, type PlatformActor } from '../../../core/access/actor.js';
import { MessagingService } from './messaging.service.js';

const idParam = { schema: idSchema };

/**
 * Vertex's platform WhatsApp numbers (spec S03; screens in PR 4): admins and support read them,
 * admins act on them. Every action but reading the QR needs a TOTP re-entry within 5 minutes
 * (spec S02 rule 40).
 */
@Controller('console')
@NoFeature()
export class MessagingConsoleController {
  constructor(@Inject(MessagingService) private readonly messaging: MessagingService) {}

  @Get('whatsapp-sessions')
  @ConsoleRoute('console.messaging.read')
  @SerializeOptions({ schema: platformWhatsAppSessionListSchema })
  list() {
    return this.messaging.listSessions();
  }

  @Get('whatsapp-sessions/:id')
  @ConsoleRoute('console.messaging.read')
  @SerializeOptions({ schema: whatsappSessionDetailSchema })
  get(@Param('id', idParam) id: string) {
    return this.messaging.getSession(id);
  }

  @Get('messaging/health')
  @ConsoleRoute('console.messaging.read')
  @SerializeOptions({ schema: messagingHealthSchema })
  health() {
    return this.messaging.health();
  }

  @Post('whatsapp-sessions')
  @ConsoleRoute({ reauth: true }, 'console.messaging.manage')
  @SerializeOptions({ schema: platformWhatsAppSessionSchema })
  create(
    @CurrentPlatformUser() user: PlatformActor,
    @Body({ schema: createPlatformWhatsAppSessionSchema })
    input: z.output<typeof createPlatformWhatsAppSessionSchema>,
  ) {
    return this.messaging.createSession(user, input);
  }

  @Get('whatsapp-sessions/:id/qr')
  @ConsoleRoute('console.messaging.manage')
  @SerializeOptions({ schema: whatsappQrSchema })
  qr(@Param('id', idParam) id: string) {
    return this.messaging.qr(id);
  }

  @Post('whatsapp-sessions/:id/relink')
  @HttpCode(200)
  @ConsoleRoute({ reauth: true }, 'console.messaging.manage')
  @SerializeOptions({ schema: platformWhatsAppSessionSchema })
  relink(@CurrentPlatformUser() user: PlatformActor, @Param('id', idParam) id: string) {
    return this.messaging.relink(user, id);
  }

  @Post('whatsapp-sessions/:id/pause')
  @HttpCode(200)
  @ConsoleRoute({ reauth: true }, 'console.messaging.manage')
  @SerializeOptions({ schema: platformWhatsAppSessionSchema })
  pause(@CurrentPlatformUser() user: PlatformActor, @Param('id', idParam) id: string) {
    return this.messaging.pause(user, id);
  }

  @Post('whatsapp-sessions/:id/resume')
  @HttpCode(200)
  @ConsoleRoute({ reauth: true }, 'console.messaging.manage')
  @SerializeOptions({ schema: platformWhatsAppSessionSchema })
  resume(@CurrentPlatformUser() user: PlatformActor, @Param('id', idParam) id: string) {
    return this.messaging.resume(user, id);
  }

  @Post('whatsapp-sessions/:id/unlink')
  @HttpCode(204)
  @ConsoleRoute({ reauth: true }, 'console.messaging.manage')
  @SerializeOptions({ schema: noContentSchema })
  async unlink(@CurrentPlatformUser() user: PlatformActor, @Param('id', idParam) id: string) {
    await this.messaging.unlink(user, id);
  }
}
