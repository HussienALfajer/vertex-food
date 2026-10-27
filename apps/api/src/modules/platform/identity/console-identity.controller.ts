import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Ip,
  Param,
  Patch,
  Post,
  Put,
  SerializeOptions,
} from '@nestjs/common';
import {
  accountPasswordResetAuthorizedSchema,
  authorizeAccountPasswordResetSchema,
  changeAccountPhoneSchema,
  changePasswordSchema,
  consoleAccountLookupSchema,
  consoleAccountSchema,
  consoleMeSchema,
  consolePolicy,
  consoleReauthenticatedSchema,
  consoleReauthSchema,
  consoleSetUpSchema,
  consoleSetupSchema,
  consoleSignInResultSchema,
  consoleSignInSchema,
  consoleTotpSchema,
  createPlatformUserSchema,
  idSchema,
  noContentSchema,
  platformUserListSchema,
  platformUserSchema,
  platformUserSetupSchema,
  updatePlatformUserSchema,
} from '@vertex-food/contracts';
import type { z } from 'zod';
import { ConsoleRoute, NoFeature, Public } from '../../../core/access/access.decorators.js';
import { CurrentPlatformUser, type PlatformActor } from '../../../core/access/actor.js';
import {
  CONSOLE_COOKIE_PATH,
  CONSOLE_SESSION_COOKIE,
} from '../../../core/access/session-verifier.js';
import { type CookieJar, ResponseCookies } from '../../../core/cookies/cookies.js';
import { ConsoleAccountsService } from './console-accounts.service.js';
import { ConsoleAuthService } from './console-auth.service.js';
import { PlatformUsersService } from './platform-users.service.js';

const idParam = { schema: idSchema };

const SESSION_SECONDS = consolePolicy.sessionMaxHours * 3600;

/**
 * Signing in to the console (spec S02 rules 38–41): the steps are public, with a proof of work
 * and limits; the session lives in an `HttpOnly` cookie under `/api/console/`.
 */
@Controller('console/auth')
@NoFeature()
export class ConsoleAuthController {
  constructor(@Inject(ConsoleAuthService) private readonly auth: ConsoleAuthService) {}

  @Post('sign-in')
  @HttpCode(200)
  @Public()
  @SerializeOptions({ schema: consoleSignInResultSchema })
  signIn(
    @Body({ schema: consoleSignInSchema }) input: z.output<typeof consoleSignInSchema>,
    @Ip() address: string,
  ) {
    return this.auth.signIn(input, address);
  }

  @Post('setup')
  @HttpCode(200)
  @Public()
  @SerializeOptions({ schema: consoleSetUpSchema })
  async setup(
    @Body({ schema: consoleSetupSchema }) input: z.output<typeof consoleSetupSchema>,
    @Ip() address: string,
    @ResponseCookies() cookies: CookieJar,
  ) {
    const { me, token } = await this.auth.setup(input, address);
    cookies.set(CONSOLE_SESSION_COOKIE, token, CONSOLE_COOKIE_PATH, SESSION_SECONDS);
    return me;
  }

  @Post('totp')
  @HttpCode(200)
  @Public()
  @SerializeOptions({ schema: consoleMeSchema })
  async totp(
    @Body({ schema: consoleTotpSchema }) input: z.output<typeof consoleTotpSchema>,
    @Ip() address: string,
    @ResponseCookies() cookies: CookieJar,
  ) {
    const { me, token } = await this.auth.totp(input, address);
    cookies.set(CONSOLE_SESSION_COOKIE, token, CONSOLE_COOKIE_PATH, SESSION_SECONDS);
    return me;
  }

  @Post('reauth')
  @HttpCode(200)
  @ConsoleRoute()
  @SerializeOptions({ schema: consoleReauthenticatedSchema })
  reauthenticate(
    @CurrentPlatformUser() user: PlatformActor,
    @Body({ schema: consoleReauthSchema }) input: z.output<typeof consoleReauthSchema>,
  ) {
    return this.auth.reauthenticate(user, input.code);
  }

  @Post('sign-out')
  @HttpCode(204)
  @ConsoleRoute()
  @SerializeOptions({ schema: noContentSchema })
  async signOut(@CurrentPlatformUser() user: PlatformActor, @ResponseCookies() cookies: CookieJar) {
    await this.auth.signOut(user);
    cookies.clear(CONSOLE_SESSION_COOKIE, CONSOLE_COOKIE_PATH);
  }
}

/** The signed-in platform user (screen 17). */
@Controller('console/me')
@NoFeature()
export class ConsoleMeController {
  constructor(@Inject(ConsoleAuthService) private readonly auth: ConsoleAuthService) {}

  @Get()
  @ConsoleRoute()
  @SerializeOptions({ schema: consoleMeSchema })
  me(@CurrentPlatformUser() user: PlatformActor) {
    return this.auth.me(user);
  }

  @Put('password')
  @HttpCode(204)
  @ConsoleRoute()
  @SerializeOptions({ schema: noContentSchema })
  async changePassword(
    @CurrentPlatformUser() user: PlatformActor,
    @Body({ schema: changePasswordSchema }) input: z.output<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(user, input);
  }
}

/** Platform users (rules 38, 42; screen 16): admins only, writes after a TOTP re-entry. */
@Controller('console/platform-users')
@NoFeature()
export class PlatformUsersController {
  constructor(@Inject(PlatformUsersService) private readonly users: PlatformUsersService) {}

  @Get()
  @ConsoleRoute('console.users.manage')
  @SerializeOptions({ schema: platformUserListSchema })
  list() {
    return this.users.list();
  }

  @Post()
  @ConsoleRoute({ reauth: true }, 'console.users.manage')
  @SerializeOptions({ schema: platformUserSetupSchema })
  create(
    @CurrentPlatformUser() user: PlatformActor,
    @Body({ schema: createPlatformUserSchema }) input: z.output<typeof createPlatformUserSchema>,
  ) {
    return this.users.create(user, input);
  }

  @Patch(':id')
  @ConsoleRoute({ reauth: true }, 'console.users.manage')
  @SerializeOptions({ schema: platformUserSchema })
  update(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: updatePlatformUserSchema }) input: z.output<typeof updatePlatformUserSchema>,
  ) {
    return this.users.update(user, id, input);
  }

  @Post(':id/reset')
  @HttpCode(200)
  @ConsoleRoute({ reauth: true }, 'console.users.manage')
  @SerializeOptions({ schema: platformUserSetupSchema })
  reset(@CurrentPlatformUser() user: PlatformActor, @Param('id', idParam) id: string) {
    return this.users.reset(user, id);
  }
}

/** Owner recovery by Vertex support (rule 15); screens in S22. The phone travels in the body. */
@Controller('console/accounts')
@NoFeature()
export class ConsoleAccountsController {
  constructor(@Inject(ConsoleAccountsService) private readonly accounts: ConsoleAccountsService) {}

  @Post('lookup')
  @HttpCode(200)
  @ConsoleRoute('console.accounts.recover')
  @SerializeOptions({ schema: consoleAccountSchema })
  lookup(
    @Body({ schema: consoleAccountLookupSchema }) input: z.output<
      typeof consoleAccountLookupSchema
    >,
  ) {
    return this.accounts.lookup(input.phone);
  }

  @Post(':id/password-reset')
  @HttpCode(200)
  @ConsoleRoute({ reauth: true }, 'console.accounts.recover')
  @SerializeOptions({ schema: accountPasswordResetAuthorizedSchema })
  authorizePasswordReset(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: authorizeAccountPasswordResetSchema })
    input: z.output<typeof authorizeAccountPasswordResetSchema>,
  ) {
    return this.accounts.authorizePasswordReset(user, id, input.reason);
  }

  @Put(':id/phone')
  @ConsoleRoute({ reauth: true }, 'console.accounts.recover')
  @SerializeOptions({ schema: consoleAccountSchema })
  changePhone(
    @CurrentPlatformUser() user: PlatformActor,
    @Param('id', idParam) id: string,
    @Body({ schema: changeAccountPhoneSchema }) input: z.output<typeof changeAccountPhoneSchema>,
  ) {
    return this.accounts.changePhone(user, id, input.phone, input.reason);
  }
}
