import { Global, Module } from '@nestjs/common';
import { nonceTtlSeconds } from '@vertex-food/contracts';
import { KeyedHash, SecretBox } from '@vertex-food/crypto';
import type { Database } from '@vertex-food/db';
import { SESSION_VERIFIER } from '../../../core/access/session-verifier.js';
import type { Config } from '../../../core/config/config.js';
import { CONFIG } from '../../../core/config/config.module.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { MEMBER_CREDENTIALS, STAFF_ACCOUNTS } from '../access/index.js';
import { GatewayOtpSender, messagingCrypto, PLATFORM_USER_NAMES } from '../messaging/index.js';
import { TENANT_DEVICES } from '../tenancy/index.js';
import { StaffAccountsStore } from './accounts.js';
import { AuthService } from './auth.service.js';
import { ConsoleAccountsService } from './console-accounts.service.js';
import { ConsoleAuthService } from './console-auth.service.js';
import {
  ConsoleAccountsController,
  ConsoleAuthController,
  ConsoleMeController,
  PlatformUsersController,
} from './console-identity.controller.js';
import { TenantDevicesStore } from './device-access.js';
import { DEVICE_NONCES, DevicesService, KEYED_HASH, SECRET_BOX } from './devices.service.js';
import {
  AuthController,
  DevicesController,
  JwksController,
  MeController,
  SessionsController,
  StaffPinController,
} from './identity.controller.js';
import { MeService } from './me.service.js';
import { OtpChallenges } from './otp-challenges.js';
import { FakeOtpSender, OTP_SENDER, type OtpSender } from './otp-sender.js';
import { PersonalDeviceStore } from './personal-devices.js';
import { MemberCredentialsStore } from './pins.js';
import { PlatformUserNamesStore, PlatformUsersService } from './platform-users.service.js';
import { ProofOfWork } from './proof-of-work.js';
import { SessionsService } from './sessions.service.js';
import { SignInLock } from './sign-in-lock.js';
import { Nonces } from './single-use.js';
import { SessionIssuer } from './staff-sessions.js';
import { Tickets } from './tickets.js';
import { TokenSigner } from './tokens.js';

/**
 * Accounts, sign-in, OTPs, registered PCs and their member lists, PINs, staff sessions and
 * personal devices, and the console's platform users, sessions and owner recovery (spec S02, ADR
 * 0032). Global, because it provides the ports other modules and
 * the core declare: the session verifier of the authentication step (`SESSION_VERIFIER`), the
 * tenant's PCs for tenancy (`TENANT_DEVICES`), the accounts and member credentials of staff
 * management in access (`STAFF_ACCOUNTS`, `MEMBER_CREDENTIALS`), and the platform users' names of
 * messaging (`PLATFORM_USER_NAMES`). It takes messaging's gateway OTP sender when
 * `OTP_SENDER=gateway`.
 */
@Global()
@Module({
  controllers: [
    AuthController,
    JwksController,
    DevicesController,
    SessionsController,
    MeController,
    StaffPinController,
    ConsoleAuthController,
    ConsoleMeController,
    PlatformUsersController,
    ConsoleAccountsController,
  ],
  providers: [
    {
      provide: KEYED_HASH,
      inject: [CONFIG],
      useFactory: (config: Config) => new KeyedHash(config.identity.hashKey),
    },
    {
      provide: SECRET_BOX,
      inject: [CONFIG],
      useFactory: (config: Config) => new SecretBox(config.identity.encryptionKey),
    },
    {
      provide: TokenSigner,
      inject: [CONFIG],
      useFactory: (config: Config) => new TokenSigner(config.identity.tokenKey),
    },
    {
      provide: ProofOfWork,
      inject: [DATABASE, KEYED_HASH, CONFIG],
      useFactory: (db: Database, hashes: KeyedHash, config: Config) =>
        new ProofOfWork(db, hashes, config.identity.powDifficulty),
    },
    {
      provide: Tickets,
      inject: [DATABASE, TokenSigner, KEYED_HASH],
      useFactory: (db: Database, tokens: TokenSigner, hashes: KeyedHash) =>
        new Tickets(db, tokens, hashes),
    },
    {
      provide: SessionIssuer,
      inject: [TokenSigner, KEYED_HASH],
      useFactory: (tokens: TokenSigner, hashes: KeyedHash) => new SessionIssuer(tokens, hashes),
    },
    {
      provide: PersonalDeviceStore,
      inject: [KEYED_HASH],
      useFactory: (hashes: KeyedHash) => new PersonalDeviceStore(hashes),
    },
    {
      provide: SignInLock,
      inject: [DATABASE],
      useFactory: (db: Database) => new SignInLock(db),
    },
    // The WhatsApp gateway's sender (spec S03); `loadConfig` refuses the fake in production.
    {
      provide: OTP_SENDER,
      inject: [CONFIG],
      useFactory: (config: Config): OtpSender =>
        config.identity.otpSender === 'gateway'
          ? new GatewayOtpSender(messagingCrypto(config.messaging))
          : new FakeOtpSender(),
    },
    {
      provide: OtpChallenges,
      inject: [DATABASE, KEYED_HASH, OTP_SENDER],
      useFactory: (db: Database, hashes: KeyedHash, sender: OtpSender) =>
        new OtpChallenges(db, hashes, sender),
    },
    { provide: DEVICE_NONCES, useFactory: () => new Nonces(nonceTtlSeconds * 1000) },
    AuthService,
    DevicesService,
    SessionsService,
    MeService,
    ConsoleAuthService,
    PlatformUsersService,
    ConsoleAccountsService,
    { provide: SESSION_VERIFIER, useExisting: SessionsService },
    { provide: TENANT_DEVICES, useFactory: () => new TenantDevicesStore() },
    { provide: STAFF_ACCOUNTS, useFactory: () => new StaffAccountsStore() },
    { provide: MEMBER_CREDENTIALS, useFactory: () => new MemberCredentialsStore() },
    { provide: PLATFORM_USER_NAMES, useFactory: () => new PlatformUserNamesStore() },
  ],
  exports: [
    SESSION_VERIFIER,
    TENANT_DEVICES,
    STAFF_ACCOUNTS,
    MEMBER_CREDENTIALS,
    PLATFORM_USER_NAMES,
    OTP_SENDER,
  ],
})
export class IdentityModule {}
