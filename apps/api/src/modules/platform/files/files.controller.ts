import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  SerializeOptions,
  StreamableFile,
} from '@nestjs/common';
import { fileBytesSchema, idSchema } from '@vertex-food/contracts';
import { NoFeature, StaffRoute } from '../../../core/access/access.decorators.js';
import { CurrentStaff, type StaffActor } from '../../../core/access/actor.js';
import { FilesService } from './files.service.js';

/** A tenant's images, for the restaurant app (logo and cover previews). */
@Controller('files')
@NoFeature()
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  /**
   * The stored bytes with their stored media type; a file never changes, so it is cached for good,
   * privately (it belongs to a signed-in tenant).
   */
  @Get(':id')
  @StaffRoute('tenant.view')
  @SerializeOptions({ schema: fileBytesSchema })
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async read(@CurrentStaff() staff: StaffActor, @Param('id', { schema: idSchema }) id: string) {
    const file = await this.files.read(staff, id);
    return new StreamableFile(file.bytes, { type: file.mediaType });
  }
}
