import {
  Controller,
  type INestApplication,
  Module,
  Put,
  SerializeOptions,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { fileSchema } from '@vertex-food/contracts';
import sharp from 'sharp';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NoFeature, Public } from '../src/core/access/access.decorators.js';
import { imageUpload, type Upload, uploadedBytes } from '../src/core/uploads/image-upload.js';
import { RejectedUpload } from '../src/core/uploads/rejected-upload.js';
import { encodeImage } from '../src/modules/platform/files/index.js';
import { createTestApp } from './app.js';

// Real multipart over HTTP (S01 audit A12): the logo route's reader, refusal mapping and image
// pipeline, on a test-only public route, because the staff routes answer 401 until S02. The
// answer is what the route would store, without a tenant.

@Controller('upload-probe')
@Public()
@NoFeature()
class UploadProbeController {
  @Put('logo')
  @SerializeOptions({ schema: fileSchema })
  @UseInterceptors(RejectedUpload, imageUpload('logo'))
  async logo(@UploadedFile() file: Upload) {
    const image = await encodeImage('logo', uploadedBytes(file));
    return {
      id: uuidv7(),
      purpose: image.purpose,
      mediaType: image.mediaType,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
      createdAt: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [UploadProbeController] })
class UploadProbeModule {}

let app: INestApplication;
let png: Buffer;

beforeAll(async () => {
  app = await createTestApp({ imports: [UploadProbeModule] });
  png = await sharp({
    create: {
      width: 800,
      height: 400,
      channels: 4,
      background: { r: 200, g: 40, b: 40, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
});
afterAll(() => app.close());

const put = () => request(app.getHttpServer()).put('/api/upload-probe/logo');

async function refused(response: request.Response) {
  expect(response.status).toBe(422);
  expect(response.body.code).toBe('FILE_REJECTED');
}

describe('image uploads over HTTP', () => {
  it('re-encodes an image sent as the one file part', async () => {
    const response = await put().attach('file', png, {
      filename: 'logo.png',
      contentType: 'image/png',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ purpose: 'logo', mediaType: 'image/png', width: 512 });
  });

  it('refuses a request with no file, another field name, a second part or an extra field', async () => {
    await refused(await put().field('note', 'x'));
    await refused(await put().attach('image', png, 'logo.png'));
    await refused(await put().attach('file', png, 'a.png').attach('file', png, 'b.png'));
    await refused(await put().field('name', 'x').attach('file', png, 'logo.png'));
    await refused(await put());
  });

  it('refuses a file over the upload size, before reading it as an image', async () => {
    const large = Buffer.alloc(2 * 1024 * 1024 + 1, 1);
    await refused(await put().attach('file', large, 'large.png'));
  });

  it('decides by the bytes, never by the name or the declared type', async () => {
    const text = Buffer.from('not an image at all');
    await refused(
      await put().attach('file', text, { filename: 'logo.png', contentType: 'image/png' }),
    );
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .gif()
      .toBuffer();
    await refused(
      await put().attach('file', gif, { filename: 'logo.png', contentType: 'image/png' }),
    );
  });
});
