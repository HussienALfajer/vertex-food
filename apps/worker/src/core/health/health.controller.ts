import { Controller, Get, SerializeOptions } from '@nestjs/common';
import { type Liveness, livenessSchema } from '@vertex-food/contracts';

/** For the process manager and uptime monitors on the server: the worker process is up. */
@Controller('health')
export class HealthController {
  @Get()
  @SerializeOptions({ schema: livenessSchema })
  check(): Liveness {
    return { status: 'ok' };
  }
}
