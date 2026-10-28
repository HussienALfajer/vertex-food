import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Ip,
  Param,
  Patch,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  changePasswordSchema,
  changePinSchema,
  deviceListSchema,
  deviceSchema,
  deviceTokenChallengeSchema,
  deviceTokenRequestSchema,
  deviceTokenSchema,
  endSessionSchema,
  idSchema,
  jwksSchema,
  memberListAckSchema,
  memberListQuerySchema,
  memberListResultSchema,
  meSchema,
  noContentSchema,
  nonceSchema,
  openSessionSchema,
  otpChallengeSchema,
  otpDeliverySchema,
  otpRequestSchema,
  otpResendSchema,
  otpVerifiedSchema,
  otpVerifySchema,
  personalDeviceListSchema,
  personalSessionRequestSchema,
  proofOfWorkChallengeSchema,
  reauthenticateSchema,
  refreshSessionSchema,
  registerDeviceSchema,
  registeredDeviceSchema,
  renameDeviceSchema,
  revokeDeviceSchema,
  sessionTokensSchema,
  setMemberPinSchema,
  setPasswordSchema,
  signInResultSchema,
  signInSchema,
  signInTicketSchema,
  tenantOptionsSchema,
} from '@vertex-food/contracts';
import type { z } from 'zod';
import {
  DeviceRoute,
  NoFeature,
  Public,
  StaffRoute,
  TicketRoute,
} from '../../../core/access/access.decorators.js';
import {
  CurrentDevice,
  CurrentStaff,
  CurrentTicket,
  type DeviceActor,
  type StaffActor,
  type Ticket,
} from '../../../core/access/actor.js';
import { cookieValue } from '../../../core/access/authentication.js';
import {
  DEVICE_TOKEN_HEADER,
  PERSONAL_DEVICE_COOKIE,
  STAFF_SESSION_COOKIE,
} from '../../../core/access/session-verifier.js';
import { type CookieJar, ResponseCookies } from '../../../core/cookies/cookies.js';
import { AuthService } from './auth.service.js';
import { DevicesService } from './devices.service.js';
import { MeService } from './me.service.js';
import { SessionsService } from './sessions.service.js';
import { TokenSigner } from './tokens.js';

const idParam = { schema: idSchema };

/** Signing in: proof of work, password, OTPs, the first password, tenant choice (spec S02). */
@Controller('auth')
@NoFeature()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('pow')
  @HttpCode(200)
  @Public()
  @SerializeOptions({ schema: proofOfWorkChallengeSchema })
  proofOfWork(@Ip() address: string) {
    return this.auth.proofOfWork(address);
  }

  @Post('sign-in')
  @HttpCode(200)
  @Public()
  @SerializeOptions({ schema: signInResultSchema })
  signIn(
    @Body({ schema: signInSchema }) input: z.output<typeof signInSchema>,
    @Ip() address: string,
    @Headers(DEVICE_TOKEN_HEADER) deviceToken: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @ResponseCookies() cookies: CookieJar,
  ) {
    return this.auth.signIn(
      input,
      address,
      { deviceToken, personalDeviceToken: cookieValue(cookie, PERSONAL_DEVICE_COOKIE) },
      cookies,
    );
  }

  @Post('otp/request')
  @HttpCode(200)
  @Public()
  @SerializeOptions({ schema: otpChallengeSchema })
  requestOtp(
    @Body({ schema: otpRequestSchema }) input: z.output<typeof otpRequestSchema>,
    @Ip() address: string,
  ) {
    return this.auth.requestOtp(input, address);
  }

  @Post('otp/resend')
  @HttpCode(200)
  @Public()
  @SerializeOptions({ schema: otpChallengeSchema })
  resendOtp(
    @Body({ schema: otpResendSchema }) input: z.output<typeof otpResendSchema>,
    @Ip() address: string,
  ) {
    return this.auth.resendOtp(input.challengeId, address);
  }

  @Get('otp/:challengeId/delivery')
  @Public()
  @SerializeOptions({ schema: otpDeliverySchema })
  otpDelivery(@Param('challengeId', idParam) challengeId: string, @Ip() address: string) {
    return this.auth.otpDelivery(challengeId, address);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Public()
  @SerializeOptions({ schema: otpVerifiedSchema })
  verifyOtp(
    @Body({ schema: otpVerifySchema }) input: z.output<typeof otpVerifySchema>,
    @Ip() address: string,
    @Headers('user-agent') userAgent: string | undefined,
    @ResponseCookies() cookies: CookieJar,
  ) {
    return this.auth.verifyOtp(input, address, userAgent, cookies);
  }

  @Post('password')
  @HttpCode(200)
  @TicketRoute('set_password')
  @SerializeOptions({ schema: signInTicketSchema })
  setPassword(
    @CurrentTicket() ticket: Ticket,
    @Body({ schema: setPasswordSchema }) input: z.output<typeof setPasswordSchema>,
  ) {
    return this.auth.setPassword(ticket, input);
  }

  @Get('tenant-options')
  @TicketRoute('signed_in')
  @SerializeOptions({ schema: tenantOptionsSchema })
  tenantOptions(@CurrentTicket() ticket: Ticket) {
    return this.auth.tenantOptions(ticket);
  }

  @Post('personal-session')
  @HttpCode(200)
  @TicketRoute('signed_in')
  @SerializeOptions({ schema: meSchema })
  personalSession(
    @CurrentTicket() ticket: Ticket,
    @Body({ schema: personalSessionRequestSchema })
    input: z.output<typeof personalSessionRequestSchema>,
    @ResponseCookies() cookies: CookieJar,
  ) {
    return this.auth.openPersonalSession(ticket, input.tenantId, cookies);
  }
}

/** The public key of the API's tokens, for the sync service (S04, rule 44). */
@Controller('.well-known')
@NoFeature()
export class JwksController {
  constructor(@Inject(TokenSigner) private readonly tokens: TokenSigner) {}

  @Get('jwks.json')
  @Public()
  @SerializeOptions({ schema: jwksSchema })
  jwks() {
    return this.tokens.jwks();
  }
}

/** Registered PCs: registration, device tokens, member lists, the wipe, management (rules 16–21). */
@Controller('devices')
@NoFeature()
export class DevicesController {
  constructor(@Inject(DevicesService) private readonly devices: DevicesService) {}

  @Post()
  @TicketRoute('signed_in')
  @SerializeOptions({ schema: registeredDeviceSchema })
  register(
    @CurrentTicket() ticket: Ticket,
    @Body({ schema: registerDeviceSchema }) input: z.output<typeof registerDeviceSchema>,
  ) {
    return this.devices.register(ticket, input);
  }

  @Post('token/challenge')
  @HttpCode(200)
  @Public()
  @SerializeOptions({ schema: nonceSchema })
  challenge(
    @Body({ schema: deviceTokenChallengeSchema }) input: z.output<
      typeof deviceTokenChallengeSchema
    >,
    @Ip() address: string,
  ) {
    return this.devices.challenge(input, address);
  }

  @Post('token')
  @HttpCode(200)
  @Public()
  @SerializeOptions({ schema: deviceTokenSchema })
  token(
    @Body({ schema: deviceTokenRequestSchema }) input: z.output<typeof deviceTokenRequestSchema>,
  ) {
    return this.devices.token(input);
  }

  @Get('current/members')
  @DeviceRoute()
  @SerializeOptions({ schema: memberListResultSchema })
  members(
    @CurrentDevice() device: DeviceActor,
    @Query({ schema: memberListQuerySchema }) query: z.output<typeof memberListQuerySchema>,
  ) {
    return this.devices.members(device, query.knownVersion);
  }

  @Post('current/members/ack')
  @HttpCode(204)
  @DeviceRoute()
  @SerializeOptions({ schema: noContentSchema })
  async acknowledge(
    @CurrentDevice() device: DeviceActor,
    @Body({ schema: memberListAckSchema }) input: z.output<typeof memberListAckSchema>,
  ) {
    await this.devices.acknowledge(device, input.version);
  }

  @Post('current/wiped')
  @HttpCode(204)
  @DeviceRoute({ allowRevoked: true })
  @SerializeOptions({ schema: noContentSchema })
  async wiped(@CurrentDevice() device: DeviceActor) {
    await this.devices.wiped(device);
  }

  @Get()
  @StaffRoute('devices.manage')
  @SerializeOptions({ schema: deviceListSchema })
  list(@CurrentStaff() staff: StaffActor) {
    return this.devices.list(staff);
  }

  @Get(':id')
  @StaffRoute('devices.manage')
  @SerializeOptions({ schema: deviceSchema })
  get(@CurrentStaff() staff: StaffActor, @Param('id', idParam) id: string) {
    return this.devices.get(staff, id);
  }

  @Patch(':id')
  @StaffRoute('devices.manage')
  @SerializeOptions({ schema: deviceSchema })
  rename(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: renameDeviceSchema }) input: z.output<typeof renameDeviceSchema>,
  ) {
    return this.devices.rename(staff, id, input.name);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @StaffRoute({ reauth: true }, 'devices.manage')
  @SerializeOptions({ schema: deviceSchema })
  revoke(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: revokeDeviceSchema }) input: z.output<typeof revokeDeviceSchema>,
  ) {
    return this.devices.revoke(staff, id, input);
  }
}

/** Staff sessions: PIN sign-in on a PC, refresh, end, password re-entry (rules 22–27, 32). */
@Controller('sessions')
@NoFeature()
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  @Post()
  @DeviceRoute()
  @SerializeOptions({ schema: sessionTokensSchema })
  open(
    @CurrentDevice() device: DeviceActor,
    @Body({ schema: openSessionSchema }) input: z.output<typeof openSessionSchema>,
  ) {
    return this.sessions.open(device, input);
  }

  @Post('refresh')
  @HttpCode(200)
  @DeviceRoute()
  @SerializeOptions({ schema: sessionTokensSchema })
  refresh(
    @CurrentDevice() device: DeviceActor,
    @Body({ schema: refreshSessionSchema }) input: z.output<typeof refreshSessionSchema>,
  ) {
    return this.sessions.refresh(device, input.refreshToken);
  }

  @Post('current/end')
  @HttpCode(204)
  @StaffRoute({ whileClosed: true })
  @SerializeOptions({ schema: noContentSchema })
  async end(
    @CurrentStaff() staff: StaffActor,
    @Body({ schema: endSessionSchema }) input: z.output<typeof endSessionSchema>,
    @ResponseCookies() cookies: CookieJar,
  ) {
    await this.sessions.end(staff, input.reason);
    if (staff.sessionKind === 'personal') cookies.clear(STAFF_SESSION_COOKIE, '/api/');
  }

  @Post('current/reauth')
  @HttpCode(204)
  @StaffRoute()
  @SerializeOptions({ schema: noContentSchema })
  async reauthenticate(
    @CurrentStaff() staff: StaffActor,
    @Body({ schema: reauthenticateSchema }) input: z.output<typeof reauthenticateSchema>,
  ) {
    await this.sessions.reauthenticate(staff, input.password);
  }
}

/** The signed-in member's own account (rules 10, 22, 35). */
@Controller('me')
@NoFeature()
export class MeController {
  constructor(@Inject(MeService) private readonly me: MeService) {}

  @Get()
  @StaffRoute()
  @SerializeOptions({ schema: meSchema })
  get(@CurrentStaff() staff: StaffActor) {
    return this.me.me(staff);
  }

  @Put('password')
  @HttpCode(204)
  @StaffRoute()
  @SerializeOptions({ schema: noContentSchema })
  async changePassword(
    @CurrentStaff() staff: StaffActor,
    @Body({ schema: changePasswordSchema }) input: z.output<typeof changePasswordSchema>,
  ) {
    await this.me.changePassword(staff, input);
  }

  @Put('pin')
  @HttpCode(204)
  @StaffRoute({ device: 'required' })
  @SerializeOptions({ schema: noContentSchema })
  async changePin(
    @CurrentStaff() staff: StaffActor,
    @Body({ schema: changePinSchema }) input: z.output<typeof changePinSchema>,
  ) {
    await this.me.changePin(staff, input);
  }

  // The account's devices are account-wide: the password, entered in this session, first.
  @Get('personal-devices')
  @StaffRoute({ reauth: true })
  @SerializeOptions({ schema: personalDeviceListSchema })
  personalDevices(@CurrentStaff() staff: StaffActor) {
    return this.me.listPersonalDevices(staff);
  }

  @Post('personal-devices/:id/revoke')
  @HttpCode(200)
  @StaffRoute({ reauth: true })
  @SerializeOptions({ schema: personalDeviceListSchema })
  revokePersonalDevice(@CurrentStaff() staff: StaffActor, @Param('id', idParam) id: string) {
    return this.me.revokePersonalDevice(staff, id);
  }
}

/** A member's PIN set by a manager on a registered PC of their branch (rule 22). */
@Controller('staff')
@NoFeature()
export class StaffPinController {
  constructor(@Inject(MeService) private readonly me: MeService) {}

  @Put(':id/pin')
  @HttpCode(204)
  @StaffRoute({ device: 'required', reauth: true }, 'staff.manage')
  @SerializeOptions({ schema: noContentSchema })
  async setPin(
    @CurrentStaff() staff: StaffActor,
    @Param('id', idParam) id: string,
    @Body({ schema: setMemberPinSchema }) input: z.output<typeof setMemberPinSchema>,
  ) {
    await this.me.setMemberPin(staff, id, input.pin);
  }
}
