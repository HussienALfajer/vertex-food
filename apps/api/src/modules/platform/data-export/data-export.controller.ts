import type { Writable } from 'node:stream';
import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Ip,
  Param,
  Post,
  Query,
  SerializeOptions,
  StreamableFile,
} from '@nestjs/common';
import {
  dataExportLinkSchema,
  dataExportListQuerySchema,
  dataExportPageSchema,
  dataExportSchema,
  dataExportTokenSchema,
  fileBytesSchema,
  idSchema,
} from '@vertex-food/contracts';
import type { z } from 'zod';
import {
  NoFeature,
  Public,
  StaffRoute,
  SuspendedAllowed,
} from '../../../core/access/access.decorators.js';
import { CurrentStaff, type StaffActor } from '../../../core/access/actor.js';
import { type FileHead, FileType, ResponseFileHead } from '../../../core/http/file-head.js';
import { RateLimiter } from '../../../core/rate-limit/rate-limiter.js';
import { DataExportService } from './data-export.service.js';

const idParam = { schema: idSchema };

/**
 * «تصدير البيانات» (spec S06): the owner's exports. No feature: taking the restaurant's data is a
 * right of every tenant (ADR 0016). The two writes pass while the tenant is suspended, and for a
 * closed tenant's owner during its 90 days (S01 rule 9).
 */
@Controller('tenant/data-exports')
@NoFeature()
export class DataExportsController {
  constructor(@Inject(DataExportService) private readonly exports: DataExportService) {}

  @Post()
  @StaffRoute({ reauth: true, whileClosed: true }, 'data.export')
  @SuspendedAllowed()
  @SerializeOptions({ schema: dataExportSchema })
  request(@CurrentStaff() staff: StaffActor) {
    return this.exports.request(staff);
  }

  @Get()
  @StaffRoute('data.export')
  @SerializeOptions({ schema: dataExportPageSchema })
  list(
    @CurrentStaff() staff: StaffActor,
    @Query({ schema: dataExportListQuerySchema }) query: z.output<typeof dataExportListQuerySchema>,
  ) {
    return this.exports.list(staff, query.before);
  }

  @Get(':id')
  @StaffRoute('data.export')
  @SerializeOptions({ schema: dataExportSchema })
  get(@CurrentStaff() staff: StaffActor, @Param('id', idParam) id: string) {
    return this.exports.get(staff, id);
  }

  @Post(':id/link')
  @StaffRoute({ whileClosed: true }, 'data.export')
  @SuspendedAllowed()
  @SerializeOptions({ schema: dataExportLinkSchema })
  link(@CurrentStaff() staff: StaffActor, @Param('id', idParam) id: string) {
    return this.exports.link(staff, id);
  }
}

const MINUTE_MS = 60_000;

/**
 * The download of a link (spec S06 rule 17): public, the token is the secret; `Range` resumes a
 * broken download. Rate-limited per address against token guessing.
 */
@Controller('data-exports/files')
@NoFeature()
export class DataExportFilesController {
  private readonly readsPerAddress = new RateLimiter(120, 10 * MINUTE_MS);

  constructor(@Inject(DataExportService) private readonly exports: DataExportService) {}

  @Get(':token')
  @Public()
  @SerializeOptions({ schema: fileBytesSchema })
  @FileType('application/zip')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async download(
    @Param('token', { schema: dataExportTokenSchema }) token: string,
    @Headers('range') range: string | undefined,
    @Ip() address: string,
    @ResponseFileHead() head: FileHead,
  ) {
    this.readsPerAddress.take(`address:${address}`);
    const file = await this.exports.download(token, range);
    head.set('Accept-Ranges', 'bytes');
    head.set('ETag', `"${file.sha256}"`);
    if (file.range.kind === 'unsatisfiable') {
      head.status = 416;
      head.set('Content-Range', `bytes */${file.byteSize}`);
      return new StreamableFile(file.open(), { type: 'application/zip', length: 0 });
    }
    const { start, end } =
      file.range.kind === 'partial' ? file.range : { start: 0, end: file.byteSize - 1 };
    if (file.range.kind === 'partial') {
      head.status = 206;
      head.set('Content-Range', `bytes ${start}-${end}/${file.byteSize}`);
    }
    // A chunk gone mid-download (the export expired) cuts the connection: the client sees a short
    // file against `Content-Length` and asks again, to `NOT_FOUND` (edge case 13).
    return new StreamableFile(file.open(), {
      type: 'application/zip',
      disposition: `attachment; filename="${file.fileName}"`,
      length: end - start + 1,
    }).setErrorHandler((_error, response) => (response as unknown as Writable).destroy());
  }
}
