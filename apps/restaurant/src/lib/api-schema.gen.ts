// Generated from apps/api/openapi.json by test/api-schema.test.ts; never edit by hand.
export interface paths {
    "/api/.well-known/jwks.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["JwksController.jwks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/access/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AccessController.catalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/otp/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController.requestOtp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/otp/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController.resendOtp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/otp/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController.verifyOtp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController.setPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/personal-session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController.personalSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/pow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController.proofOfWork"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sign-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController.signIn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/tenant-options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuthController.tenantOptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/branches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["BranchesController.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/branches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["BranchesController.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["BranchesController.update"];
        trace?: never;
    };
    "/api/branches/{id}/charges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["BranchesController.replaceCharges"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/branches/{id}/hour-exceptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["BranchesController.createException"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/branches/{id}/hour-exceptions/{exceptionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["BranchesController.archiveException"];
        options?: never;
        head?: never;
        patch: operations["BranchesController.updateException"];
        trace?: never;
    };
    "/api/branches/{id}/hours": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["BranchesController.replaceHours"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/branches/{id}/security": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["BranchesController.updateSecurity"];
        trace?: never;
    };
    "/api/cities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AreasController.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/accounts/{id}/password-reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConsoleAccountsController.authorizePasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/accounts/{id}/phone": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["ConsoleAccountsController.changePhone"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/accounts/lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConsoleAccountsController.lookup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/auth/reauth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConsoleAuthController.reauthenticate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/auth/setup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConsoleAuthController.setup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/auth/sign-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConsoleAuthController.signIn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/auth/sign-out": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConsoleAuthController.signOut"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/auth/totp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConsoleAuthController.totp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ConsoleMeController.me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/me/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["ConsoleMeController.changePassword"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/platform-users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlatformUsersController.list"];
        put?: never;
        post: operations["PlatformUsersController.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/platform-users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["PlatformUsersController.update"];
        trace?: never;
    };
    "/api/console/platform-users/{id}/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PlatformUsersController.reset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/tenants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TenancyConsoleController.list"];
        put?: never;
        post: operations["TenancyConsoleController.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/tenants/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TenancyConsoleController.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/tenants/{id}/branches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TenancyConsoleController.createBranch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/tenants/{id}/branches/{branchId}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TenancyConsoleController.archiveBranch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/tenants/{id}/slug": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["TenancyConsoleController.setSlug"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/tenants/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TenancyConsoleController.changeStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DevicesController.list"];
        put?: never;
        post: operations["DevicesController.register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/devices/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DevicesController.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["DevicesController.rename"];
        trace?: never;
    };
    "/api/devices/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DevicesController.revoke"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/devices/current/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DevicesController.members"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/devices/current/members/ack": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DevicesController.acknowledge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/devices/current/wiped": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DevicesController.wiped"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/devices/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DevicesController.token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/devices/token/challenge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DevicesController.challenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController.read"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthCheckController.check"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/maps/resolve-link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MapsController.resolve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MeController.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/me/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["MeController.changePassword"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/me/personal-devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MeController.personalDevices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/me/personal-devices/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MeController.revokePersonalDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/me/pin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["MeController.changePin"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SessionsController.open"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/current/end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SessionsController.end"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/current/reauth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SessionsController.reauthenticate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SessionsController.refresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/staff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StaffController.list"];
        put?: never;
        post: operations["StaffController.add"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/staff/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StaffController.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/staff/{id}/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["StaffController.changeAccess"];
        trace?: never;
    };
    "/api/staff/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffController.deactivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/staff/{id}/password-reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffController.authorizePasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/staff/{id}/pin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["StaffPinController.setPin"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/staff/{id}/reactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffController.reactivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tenant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TenantController.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["TenantController.update"];
        trace?: never;
    };
    "/api/tenant/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["TenantController.replaceCover"];
        post?: never;
        delete: operations["TenantController.removeCover"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tenant/logo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["TenantController.replaceLogo"];
        post?: never;
        delete: operations["TenantController.removeLogo"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tenant/onboarding/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TenantController.completeOnboarding"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AccessCatalog: {
            permissions: {
                key: components["schemas"]["StaffPermission"];
                group: components["schemas"]["PermissionGroup"];
                branchScoped: boolean;
                limit: components["schemas"]["StaffRole"][];
            }[];
            presets: {
                role: components["schemas"]["StaffRole"];
                permissions: components["schemas"]["StaffPermission"][];
            }[];
            ownerLockedPermissions: components["schemas"]["StaffPermission"][];
            assignableRoles: components["schemas"]["StaffRole"][];
            mayAdjustPermissions: boolean;
        };
        AccountName: string;
        AccountPasswordResetAuthorized: {
            accountId: components["schemas"]["Id"];
            passwordResetAuthorizedUntil: components["schemas"]["Instant"];
        };
        AddStaffMember: {
            phone: components["schemas"]["MobilePhoneNumber"];
            displayName: string;
            roles: components["schemas"]["StaffRole"][];
            branchScope: components["schemas"]["BranchScope"];
            /** @default [] */
            grantedPermissions: components["schemas"]["StaffPermission"][];
            /** @default [] */
            revokedPermissions: components["schemas"]["StaffPermission"][];
        };
        ArchiveBranch: {
            note?: string;
        };
        /** @enum {string} */
        AuditAction: "tenant.created" | "tenant.profile_updated" | "tenant.slug_changed" | "tenant.status_scheduled" | "tenant.status_changed" | "tenant.status_schedule_cancelled" | "tenant.status_rescheduled" | "tenant.onboarding_completed" | "tenant_logo.replaced" | "tenant_logo.archived" | "tenant_cover.replaced" | "tenant_cover.archived" | "branch.created" | "branch.updated" | "branch.archived" | "branch_hours.replaced" | "branch_hour_exception.created" | "branch_hour_exception.updated" | "branch_hour_exception.archived" | "branch_charges.replaced" | "governorate.created" | "city.created" | "staff.added" | "staff.access_changed" | "staff.deactivated" | "staff.reactivated" | "staff.password_reset_authorized" | "staff_pin.set" | "staff_pin.disabled" | "device.registered" | "device.renamed" | "device.revoked" | "device.wiped" | "staff_session.started" | "staff_session.reauthenticated" | "branch.security_updated" | "account.created" | "account.password_set" | "account.password_reset_authorized" | "account.phone_changed" | "account.sign_in_locked" | "personal_device.added" | "personal_device.revoked" | "console.request" | "platform_user.created" | "platform_user.updated" | "platform_user.disabled" | "platform_user.reset" | "platform_user.setup_completed" | "platform_user.signed_in" | "platform_user.signed_out" | "platform_user.sign_in_failed" | "platform_user.totp_failed" | "platform_user.reauthenticated" | "platform_user.password_changed";
        /** @enum {string} */
        AuditActorKind: "staff" | "customer" | "driver" | "platform" | "system";
        AuthorizeAccountPasswordReset: {
            reason: string;
        };
        Branch: {
            id: components["schemas"]["Id"];
            nameAr: string;
            nameLatin: string | null;
            code: components["schemas"]["BranchCode"];
            cityId: components["schemas"]["Id"] | null;
            addressDescription: string | null;
            location: components["schemas"]["Coordinates"] | null;
            contactPhones: components["schemas"]["ContactPhone"][];
            defaultCurrency: components["schemas"]["CurrencyCode"];
            acceptedCurrencies: components["schemas"]["CurrencyCode"][];
            currencyLockedAt: components["schemas"]["Instant"] | null;
            businessDayEndsAt: components["schemas"]["BusinessDayEnd"];
            idleLockMinutes: components["schemas"]["IdleLockMinutes"];
            createdAt: components["schemas"]["Instant"];
            updatedAt: components["schemas"]["Instant"];
            archivedAt: components["schemas"]["Instant"] | null;
        };
        BranchCharge: {
            id: components["schemas"]["Id"];
            kind: components["schemas"]["ChargeKind"];
            nameAr: string;
            nameLatin: string | null;
            rateBp: number;
            mode: components["schemas"]["ChargeMode"];
            orderTypes: components["schemas"]["OrderType"][];
            position: number;
        };
        BranchChargeInput: {
            kind: components["schemas"]["ChargeKind"];
            nameAr: string;
            nameLatin?: string | null;
            rateBp: number;
            mode: components["schemas"]["ChargeMode"];
            orderTypes: components["schemas"]["OrderType"][];
        };
        BranchCharges: {
            lines: components["schemas"]["BranchCharge"][];
            updatedAt: components["schemas"]["Instant"];
        };
        BranchCode: string;
        BranchDetail: {
            branch: components["schemas"]["Branch"];
            hours: components["schemas"]["WeeklyPeriod"][];
            exceptions: components["schemas"]["HourException"][];
            charges: components["schemas"]["BranchCharge"][];
        };
        BranchHours: {
            businessDayEndsAt: components["schemas"]["BusinessDayEnd"];
            periods: components["schemas"]["WeeklyPeriod"][];
            updatedAt: components["schemas"]["Instant"];
        };
        BranchList: components["schemas"]["Branch"][];
        BranchScope: {
            /** @constant */
            allBranches: true;
        } | {
            /** @constant */
            allBranches: false;
            branchIds: components["schemas"]["Id"][];
        };
        BusinessDayEnd: string;
        CancelScheduledTenantStatus: {
            /** @constant */
            cancelScheduled: true;
            note?: string;
        };
        ChangeAccountPhone: {
            phone: components["schemas"]["MobilePhoneNumber"];
            reason: string;
        };
        ChangePassword: {
            currentPassword: string;
            newPassword: components["schemas"]["Password"];
        };
        ChangePin: {
            currentPin?: components["schemas"]["Pin"];
            newPin: components["schemas"]["Pin"];
        };
        ChangeStaffAccess: {
            roles: components["schemas"]["StaffRole"][];
            branchScope: components["schemas"]["BranchScope"];
            grantedPermissions: components["schemas"]["StaffPermission"][];
            revokedPermissions: components["schemas"]["StaffPermission"][];
            updatedAt: components["schemas"]["Instant"];
        };
        ChangeTenantStatus: {
            /** @enum {string} */
            to: "active" | "suspended" | "closed";
            reason?: components["schemas"]["TenantStatusReason"];
            note?: string;
        };
        /** @enum {string} */
        ChargeKind: "tax" | "service";
        /** @enum {string} */
        ChargeMode: "inclusive" | "added";
        City: {
            id: components["schemas"]["Id"];
            governorateId: components["schemas"]["Id"];
            nameAr: string;
            nameLatin: string;
            archivedAt: components["schemas"]["Instant"] | null;
        };
        ConsoleAccount: {
            id: components["schemas"]["Id"];
            phone: string;
            nameAr: string | null;
            hasPassword: boolean;
            passwordResetAuthorizedUntil: components["schemas"]["Instant"] | null;
            signInLockedUntil: components["schemas"]["Instant"] | null;
            memberships: {
                tenantId: components["schemas"]["Id"];
                tenantNameAr: string;
                tenantStatus: components["schemas"]["TenantStatus"];
                membershipId: components["schemas"]["Id"];
                status: components["schemas"]["MembershipStatus"];
                roles: components["schemas"]["StaffRole"][];
            }[];
        };
        ConsoleAccountLookup: {
            phone: components["schemas"]["MobilePhoneNumber"];
        };
        ConsoleMe: {
            id: components["schemas"]["Id"];
            phone: string;
            name: string;
            role: components["schemas"]["ConsoleRole"];
            permissions: components["schemas"]["ConsolePermission"][];
            recoveryCodesRemaining: number;
            session: {
                expiresAt: components["schemas"]["Instant"];
                reauthenticatedUntil: components["schemas"]["Instant"] | null;
            };
        };
        /** @enum {string} */
        ConsolePermission: "console.tenants.manage" | "console.tenants.status" | "console.users.manage" | "console.accounts.recover";
        ConsoleReauth: {
            code: components["schemas"]["TotpCode"];
        };
        ConsoleReauthenticated: {
            reauthenticatedUntil: components["schemas"]["Instant"];
        };
        /** @enum {string} */
        ConsoleRole: "admin" | "sales" | "dispatch" | "finance" | "support";
        ConsoleSetup: {
            ticket: string;
            password: components["schemas"]["Password"];
            code: components["schemas"]["TotpCode"];
        };
        ConsoleSetUp: {
            id: components["schemas"]["Id"];
            phone: string;
            name: string;
            role: components["schemas"]["ConsoleRole"];
            permissions: components["schemas"]["ConsolePermission"][];
            recoveryCodesRemaining: number;
            session: {
                expiresAt: components["schemas"]["Instant"];
                reauthenticatedUntil: components["schemas"]["Instant"] | null;
            };
            recoveryCodes: string[];
        };
        ConsoleSignIn: {
            phone: components["schemas"]["MobilePhoneNumber"];
            password?: string;
            setupCode?: components["schemas"]["SetupCode"];
            proofOfWork: components["schemas"]["ProofOfWorkSolution"];
        };
        ConsoleSignInResult: {
            /** @constant */
            step: "totp";
            ticket: string;
        } | {
            /** @constant */
            step: "setup";
            ticket: string;
            totpSecret: string;
            totpUri: string;
        };
        ConsoleTenant: {
            id: components["schemas"]["Id"];
            slug: components["schemas"]["Slug"];
            nameAr: string;
            nameLatin: string | null;
            status: components["schemas"]["TenantStatus"];
            statusReason: components["schemas"]["TenantStatusReason"] | null;
            scheduledChange: components["schemas"]["ScheduledStatusChange"] | null;
            onboardingCompletedAt: components["schemas"]["Instant"] | null;
            activatedAt: components["schemas"]["Instant"] | null;
            branchCount: number;
            createdAt: components["schemas"]["Instant"];
            updatedAt: components["schemas"]["Instant"];
        };
        ConsoleTenantDetail: {
            tenant: components["schemas"]["ConsoleTenant"];
            slugs: components["schemas"]["TenantSlug"][];
            branches: components["schemas"]["Branch"][];
        };
        ConsoleTenantPage: {
            items: components["schemas"]["ConsoleTenant"][];
            total: number;
            page: number;
            pageSize: number;
        };
        ConsoleTotp: {
            ticket: string;
            code: components["schemas"]["TotpCode"] | components["schemas"]["RecoveryCode"];
        };
        ContactPhone: {
            phone: components["schemas"]["PhoneNumber"];
            whatsapp: boolean;
        };
        Coordinates: {
            latitudeE7: number;
            longitudeE7: number;
        };
        CreateBranch: {
            nameAr: string;
            nameLatin?: string;
            code: components["schemas"]["BranchCode"];
            defaultCurrency?: components["schemas"]["CurrencyCode"];
        };
        CreateCity: {
            governorateId: components["schemas"]["Id"];
            nameAr: string;
            nameLatin: string;
        };
        CreateGovernorate: {
            nameAr: string;
            nameLatin: string;
        };
        CreateHourException: {
            date: components["schemas"]["LocalDate"];
            closed: boolean;
            periods: components["schemas"]["OpeningPeriod"][];
            note?: string | null;
        };
        CreatePlatformUser: {
            phone: components["schemas"]["MobilePhoneNumber"];
            name: string;
            role: components["schemas"]["ConsoleRole"];
            /** @default [] */
            grantedPermissions: components["schemas"]["ConsolePermission"][];
            /** @default [] */
            revokedPermissions: components["schemas"]["ConsolePermission"][];
        };
        CreateTenant: {
            nameAr: string;
            nameLatin?: string;
            slug: string;
            defaultCurrency: components["schemas"]["CurrencyCode"];
            branches: components["schemas"]["CreateBranch"][];
            owner: {
                phone: components["schemas"]["MobilePhoneNumber"];
                displayName: string;
            };
            note?: string;
        };
        /**
         * @description ISO 4217 code; amounts are integers in minor units of 10^-exponent.
         * @enum {string}
         */
        CurrencyCode: "USD" | "TRY" | "SYP";
        DeactivateStaffMember: {
            reason: string;
        };
        Device: {
            id: components["schemas"]["Id"];
            branchId: components["schemas"]["Id"];
            name: string;
            status: components["schemas"]["DeviceStatus"];
            os: string;
            appVersion: string;
            lastSeenAt: components["schemas"]["Instant"];
            membersSyncedAt: components["schemas"]["Instant"] | null;
            registeredAt: components["schemas"]["Instant"];
            revokedAt: components["schemas"]["Instant"] | null;
            revokeReason: ("lost_or_stolen" | "replaced" | "other" | "tenant_closed") | null;
            wipedAt: components["schemas"]["Instant"] | null;
            updatedAt: components["schemas"]["Instant"];
        };
        DeviceList: components["schemas"]["Device"][];
        DeviceMember: {
            membershipId: components["schemas"]["Id"];
            name: string;
            roles: components["schemas"]["StaffRole"][];
            permissions: components["schemas"]["StaffPermission"][];
            pinVerifier: string | null;
            pinDisabled: boolean;
        };
        DeviceName: string;
        /** @enum {string} */
        DeviceRevokeReason: "lost_or_stolen" | "replaced" | "other";
        /** @enum {string} */
        DeviceStatus: "active" | "revoked";
        DeviceToken: {
            deviceToken: string;
            expiresAt: components["schemas"]["Instant"];
        };
        DeviceTokenChallenge: {
            tenantId: components["schemas"]["Id"];
            deviceId: components["schemas"]["Id"];
        };
        DeviceTokenRequest: {
            tenantId: components["schemas"]["Id"];
            deviceId: components["schemas"]["Id"];
            nonce: string;
            signature: components["schemas"]["Signature"];
            appVersion: string;
        };
        EndSession: {
            /** @enum {string} */
            reason: "signed_out" | "locked" | "idle";
        };
        /** @enum {string} */
        ErrorCode: "VALIDATION_FAILED" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_ENTITLED" | "TENANT_SUSPENDED" | "TENANT_CLOSED" | "NOT_FOUND" | "CONFLICT" | "INVALID_STATUS_TRANSITION" | "LAST_ACTIVE_BRANCH" | "SLUG_TAKEN" | "BRANCH_CURRENCY_LOCKED" | "CURRENCY_MISMATCH" | "INVALID_AMOUNT" | "ONBOARDING_INCOMPLETE" | "FILE_REJECTED" | "MAP_LINK_UNRECOGNIZED" | "SLUG_RESERVED" | "INVALID_HOURS" | "RATE_LIMITED" | "INTERNAL_ERROR" | "SERVICE_UNAVAILABLE" | "INVALID_CREDENTIALS" | "TICKET_INVALID" | "SESSION_ENDED" | "SIGNATURE_INVALID" | "DEVICE_UNKNOWN" | "INVALID_PIN" | "DEVICE_REVOKED" | "MEMBERSHIP_INACTIVE" | "BRANCH_NOT_IN_SCOPE" | "REAUTH_REQUIRED" | "DEVICE_REQUIRED" | "PIN_DISABLED" | "APPROVER_NOT_ALLOWED" | "OFFLINE_WINDOW_EXPIRED" | "POW_INVALID" | "OTP_INVALID" | "OTP_EXPIRED" | "OTP_ATTEMPTS_EXCEEDED" | "OTP_COOLDOWN" | "PASSWORD_TOO_WEAK" | "PIN_TOO_WEAK" | "TOTP_INVALID" | "PERMISSION_NOT_GRANTABLE" | "ALREADY_MEMBER" | "LAST_OWNER" | "LAST_ADMIN" | "BRANCH_HAS_DEVICES" | "OTP_DELIVERY_UNAVAILABLE";
        ErrorResponse: {
            code: components["schemas"]["ErrorCode"];
            message: string;
            details?: {
                [key: string]: unknown;
            };
        };
        ExchangeRate: {
            from: components["schemas"]["CurrencyCode"];
            to: components["schemas"]["CurrencyCode"];
            rate: string;
        };
        File: {
            id: components["schemas"]["Id"];
            purpose: components["schemas"]["FilePurpose"];
            /** @enum {string} */
            mediaType: "image/png" | "image/webp";
            byteSize: number;
            width: number;
            height: number;
            sha256: string;
            createdAt: components["schemas"]["Instant"];
        };
        FileBytes: string;
        /** @enum {string} */
        FilePurpose: "logo" | "cover";
        Governorate: {
            id: components["schemas"]["Id"];
            nameAr: string;
            nameLatin: string;
            cities: components["schemas"]["City"][];
        };
        GovernorateList: components["schemas"]["Governorate"][];
        HealthCheck: {
            /** @constant */
            status: "ok";
            /** @constant */
            database: "ok";
        };
        HourException: {
            id: components["schemas"]["Id"];
            branchId: components["schemas"]["Id"];
            date: components["schemas"]["LocalDate"];
            closed: boolean;
            periods: components["schemas"]["OpeningPeriod"][];
            note: string | null;
            createdAt: components["schemas"]["Instant"];
            updatedAt: components["schemas"]["Instant"];
        };
        /** Format: uuid */
        Id: string;
        IdleLockMinutes: number;
        /** Format: date-time */
        Instant: string;
        Jwks: {
            keys: {
                /** @constant */
                kty: "OKP";
                /** @constant */
                crv: "Ed25519";
                x: string;
                kid: string;
                /** @constant */
                alg: "EdDSA";
                /** @constant */
                use: "sig";
            }[];
        };
        ListConsoleTenantsQuery: {
            /** @default 1 */
            page: number;
            /** @default 50 */
            pageSize: number;
            /** @enum {string} */
            sort?: "createdAt" | "nameAr";
            /** @default asc */
            order: components["schemas"]["SortOrder"];
            status?: components["schemas"]["TenantStatus"];
            q?: string;
        };
        ListStaffQuery: {
            /** @default 1 */
            page: number;
            /** @default 50 */
            pageSize: number;
            /** @enum {string} */
            sort?: "displayName" | "createdAt";
            /** @default asc */
            order: components["schemas"]["SortOrder"];
            status?: components["schemas"]["MembershipStatus"];
            branchId?: components["schemas"]["Id"];
        };
        Liveness: {
            /** @constant */
            status: "ok";
        };
        /** Format: date */
        LocalDate: string;
        Me: {
            account: {
                id: components["schemas"]["Id"];
                phone: string;
                nameAr: string | null;
                hasPassword: boolean;
            };
            tenant: {
                id: components["schemas"]["Id"];
                nameAr: string;
                status: components["schemas"]["TenantStatus"];
            };
            membershipId: components["schemas"]["Id"];
            displayName: string;
            roles: components["schemas"]["StaffRole"][];
            allBranches: boolean;
            branchIds: components["schemas"]["Id"][];
            permissions: components["schemas"]["StaffPermission"][];
            sessionKind: components["schemas"]["StaffSessionKind"];
            deviceId: components["schemas"]["Id"] | null;
            branchId: components["schemas"]["Id"] | null;
            pinSet: boolean;
        };
        MemberList: {
            version: string;
            issuedAt: components["schemas"]["Instant"];
            tenant: {
                id: components["schemas"]["Id"];
                nameAr: string;
                status: components["schemas"]["TenantStatus"];
                logoFileId: components["schemas"]["Id"] | null;
            };
            branch: {
                id: components["schemas"]["Id"];
                nameAr: string;
                idleLockMinutes: components["schemas"]["IdleLockMinutes"];
            };
            device: {
                id: components["schemas"]["Id"];
                name: string;
            };
            members: components["schemas"]["DeviceMember"][];
        };
        MemberListAck: {
            version: string;
        };
        MemberListQuery: {
            knownVersion?: string;
        };
        MemberListResult: {
            /** @constant */
            status: "not_modified";
            issuedAt: components["schemas"]["Instant"];
        } | {
            /** @constant */
            status: "current";
            list: components["schemas"]["MemberList"];
        };
        /** @enum {string} */
        MembershipStatus: "active" | "deactivated";
        MissingOnboardingItem: {
            item: components["schemas"]["OnboardingItem"];
            branchId: components["schemas"]["Id"] | null;
        };
        MobilePhoneNumber: components["schemas"]["PhoneNumber"];
        Money: {
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
        };
        NoContent: null;
        Nonce: {
            nonce: string;
            expiresAt: components["schemas"]["Instant"];
        };
        OnboardingCompleteness: {
            complete: boolean;
            missing: components["schemas"]["MissingOnboardingItem"][];
        };
        /** @enum {string} */
        OnboardingItem: "tenant.name" | "branch.city" | "branch.address" | "branch.location" | "branch.phone" | "branch.hours" | "branch.currency";
        OpeningPeriod: {
            opensAt: components["schemas"]["TimeOfDay"];
            closesAt: components["schemas"]["TimeOfDay"];
        };
        OpenSession: {
            membershipId: components["schemas"]["Id"];
            pin: components["schemas"]["Pin"];
        } | {
            membershipId: components["schemas"]["Id"];
            ticket: string;
        };
        /** @enum {string} */
        OrderType: "dine_in" | "takeaway" | "delivery" | "pickup";
        OtpChallenge: {
            challengeId: components["schemas"]["Id"];
        };
        OtpCode: string;
        /** @enum {string} */
        OtpPurpose: "new_device" | "first_sign_in" | "password_reset";
        OtpRequest: {
            phone: components["schemas"]["MobilePhoneNumber"];
            /** @enum {string} */
            purpose: "first_sign_in" | "password_reset";
            intent: components["schemas"]["SignInIntent"];
            proofOfWork: components["schemas"]["ProofOfWorkSolution"];
        };
        OtpResend: {
            challengeId: components["schemas"]["Id"];
        };
        OtpVerified: {
            ticket: string;
            needsPassword: boolean;
            needsName: boolean;
            suggestedName: string | null;
        };
        OtpVerify: {
            challengeId: components["schemas"]["Id"];
            code: components["schemas"]["OtpCode"];
            intent: components["schemas"]["SignInIntent"];
        };
        Password: string;
        /** @enum {string} */
        PermissionGroup: "tenant" | "branch" | "staff" | "devices";
        PersonalDevice: {
            id: components["schemas"]["Id"];
            label: string;
            lastUsedAt: components["schemas"]["Instant"];
            expiresAt: components["schemas"]["Instant"];
            current: boolean;
        };
        PersonalDeviceList: components["schemas"]["PersonalDevice"][];
        PersonalSessionRequest: {
            tenantId: components["schemas"]["Id"];
        };
        PhoneNumber: string;
        Pin: string;
        PlatformUser: {
            id: components["schemas"]["Id"];
            phone: string;
            name: string;
            role: components["schemas"]["ConsoleRole"];
            grantedPermissions: components["schemas"]["ConsolePermission"][];
            revokedPermissions: components["schemas"]["ConsolePermission"][];
            effectivePermissions: components["schemas"]["ConsolePermission"][];
            status: components["schemas"]["PlatformUserStatus"];
            setupCodeExpiresAt: components["schemas"]["Instant"] | null;
            createdAt: components["schemas"]["Instant"];
            updatedAt: components["schemas"]["Instant"];
        };
        PlatformUserList: components["schemas"]["PlatformUser"][];
        PlatformUserSetup: {
            user: components["schemas"]["PlatformUser"];
            setupCode: string;
            setupCodeExpiresAt: components["schemas"]["Instant"];
        };
        /** @enum {string} */
        PlatformUserStatus: "pending_setup" | "active" | "disabled";
        ProofOfWorkChallenge: {
            challenge: string;
            difficulty: number;
            expiresAt: components["schemas"]["Instant"];
        };
        ProofOfWorkSolution: {
            challenge: string;
            nonce: string;
        };
        PublicKey: string;
        Reauthenticate: {
            password: string;
        };
        RecoveryCode: string;
        RefreshSession: {
            refreshToken: string;
        };
        RegisterDevice: {
            tenantId: components["schemas"]["Id"];
            branchId: components["schemas"]["Id"];
            name: components["schemas"]["DeviceName"];
            publicKey: components["schemas"]["PublicKey"];
            os: string;
            appVersion: string;
        };
        RegisteredDevice: {
            device: components["schemas"]["Device"];
            members: components["schemas"]["MemberList"];
            session: components["schemas"]["SessionTokens"];
        };
        RenameDevice: {
            name: components["schemas"]["DeviceName"];
        };
        ReplaceBranchCharges: {
            lines: components["schemas"]["BranchChargeInput"][];
            updatedAt: components["schemas"]["Instant"];
        };
        ReplaceBranchHours: {
            businessDayEndsAt: components["schemas"]["BusinessDayEnd"];
            periods: components["schemas"]["WeeklyPeriod"][];
            updatedAt: components["schemas"]["Instant"];
        };
        ResolveMapLink: {
            /** Format: uri */
            url: string;
        };
        RevokeDevice: {
            reason: components["schemas"]["DeviceRevokeReason"];
            note?: string;
        };
        ScheduledStatusChange: {
            status: components["schemas"]["ScheduledTenantStatus"];
            reason: components["schemas"]["TenantStatusReason"];
            at: components["schemas"]["Instant"];
        };
        /** @enum {string} */
        ScheduledTenantStatus: "suspended" | "closed";
        SessionTokens: {
            sessionId: components["schemas"]["Id"];
            accessToken: string;
            accessTokenExpiresAt: components["schemas"]["Instant"];
            refreshToken: string;
            expiresAt: components["schemas"]["Instant"];
        };
        SetMemberPin: {
            pin: components["schemas"]["Pin"];
        };
        SetPassword: {
            name?: components["schemas"]["AccountName"];
            password: components["schemas"]["Password"];
        };
        SetTenantSlug: {
            slug: string;
        };
        SetupCode: string;
        Signature: string;
        SignIn: {
            phone: components["schemas"]["MobilePhoneNumber"];
            password: string;
            intent: components["schemas"]["SignInIntent"];
            proofOfWork: components["schemas"]["ProofOfWorkSolution"];
        };
        /** @enum {string} */
        SignInIntent: "register_device" | "personal";
        SignInResult: {
            /** @constant */
            step: "otp";
            challengeId: components["schemas"]["Id"];
        } | {
            /** @constant */
            step: "done";
            ticket: string;
        };
        SignInTicket: {
            ticket: string;
        };
        Slug: string;
        /** @enum {string} */
        SortOrder: "asc" | "desc";
        StaffMember: {
            id: components["schemas"]["Id"];
            accountId: components["schemas"]["Id"];
            phone: string;
            displayName: string;
            nameAr: string | null;
            roles: components["schemas"]["StaffRole"][];
            allBranches: boolean;
            branchIds: components["schemas"]["Id"][];
            grantedPermissions: components["schemas"]["StaffPermission"][];
            revokedPermissions: components["schemas"]["StaffPermission"][];
            effectivePermissions: components["schemas"]["StaffPermission"][];
            status: components["schemas"]["MembershipStatus"];
            hasPassword: boolean;
            pinSet: boolean;
            pinDisabled: boolean;
            deactivatedAt: components["schemas"]["Instant"] | null;
            deactivationReason: string | null;
            createdAt: components["schemas"]["Instant"];
            updatedAt: components["schemas"]["Instant"];
        };
        StaffMemberPage: {
            items: components["schemas"]["StaffMember"][];
            total: number;
            page: number;
            pageSize: number;
        };
        /** @enum {string} */
        StaffPermission: "tenant.view" | "tenant.profile.edit" | "branch.settings.edit" | "branch.hours.edit" | "branch.security.edit" | "staff.view" | "staff.manage" | "staff.permissions.adjust" | "devices.manage" | "backoffice.remote";
        /** @enum {string} */
        StaffRole: "owner" | "manager" | "cashier" | "waiter" | "kitchen" | "driver";
        /** @enum {string} */
        StaffSessionEndReason: "signed_out" | "locked" | "idle" | "expired" | "member_deactivated" | "branch_left" | "device_revoked" | "password_reset" | "tenant_closed" | "refresh_reused" | "access_lost";
        /** @enum {string} */
        StaffSessionKind: "device" | "personal";
        Tenant: {
            id: components["schemas"]["Id"];
            slug: components["schemas"]["Slug"];
            nameAr: string;
            nameLatin: string | null;
            defaultCurrency: components["schemas"]["CurrencyCode"];
            status: components["schemas"]["TenantStatus"];
            statusReason: components["schemas"]["TenantStatusReason"] | null;
            statusChangedAt: components["schemas"]["Instant"];
            scheduledChange: components["schemas"]["ScheduledStatusChange"] | null;
            onboardingCompletedAt: components["schemas"]["Instant"] | null;
            activatedAt: components["schemas"]["Instant"] | null;
            closedAt: components["schemas"]["Instant"] | null;
            ownerReadUntil: components["schemas"]["Instant"] | null;
            onboarding: components["schemas"]["OnboardingCompleteness"];
            logoFileId: components["schemas"]["Id"] | null;
            coverFileId: components["schemas"]["Id"] | null;
            branchCount: number;
            createdAt: components["schemas"]["Instant"];
            updatedAt: components["schemas"]["Instant"];
        };
        TenantOptions: {
            intent: components["schemas"]["SignInIntent"];
            tenants: {
                tenantId: components["schemas"]["Id"];
                nameAr: string;
                status: components["schemas"]["TenantStatus"];
                logoFileId: components["schemas"]["Id"] | null;
                branches: {
                    id: components["schemas"]["Id"];
                    nameAr: string;
                }[];
            }[];
        };
        TenantSlug: {
            slug: components["schemas"]["Slug"];
            isPrimary: boolean;
            createdAt: components["schemas"]["Instant"];
        };
        /** @enum {string} */
        TenantStatus: "onboarding" | "active" | "suspended" | "closed";
        /** @enum {string} */
        TenantStatusReason: "non_payment" | "abuse" | "other";
        TenantStatusRequest: components["schemas"]["ChangeTenantStatus"] | components["schemas"]["CancelScheduledTenantStatus"];
        TimeOfDay: string;
        TotpCode: string;
        UpdateBranch: {
            nameAr?: string;
            nameLatin?: string | null;
            cityId?: components["schemas"]["Id"];
            addressDescription?: string;
            location?: components["schemas"]["Coordinates"];
            contactPhones?: components["schemas"]["ContactPhone"][];
            defaultCurrency?: components["schemas"]["CurrencyCode"];
            acceptedCurrencies?: components["schemas"]["CurrencyCode"][];
            updatedAt: components["schemas"]["Instant"];
        };
        UpdateBranchSecurity: {
            idleLockMinutes: components["schemas"]["IdleLockMinutes"];
            updatedAt: components["schemas"]["Instant"];
        };
        UpdateHourException: {
            closed: boolean;
            periods: components["schemas"]["OpeningPeriod"][];
            note: string | null;
            updatedAt: components["schemas"]["Instant"];
        };
        UpdatePlatformUser: {
            role?: components["schemas"]["ConsoleRole"];
            grantedPermissions?: components["schemas"]["ConsolePermission"][];
            revokedPermissions?: components["schemas"]["ConsolePermission"][];
            disabled?: boolean;
        };
        UpdateTenant: {
            nameAr: string;
            nameLatin: string | null;
            defaultCurrency: components["schemas"]["CurrencyCode"];
            updatedAt: components["schemas"]["Instant"];
        };
        Weekday: number;
        WeeklyPeriod: {
            weekday: components["schemas"]["Weekday"];
            opensAt: components["schemas"]["TimeOfDay"];
            closesAt: components["schemas"]["TimeOfDay"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    "JwksController.jwks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Jwks"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "AccessController.catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessCatalog"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "AuthController.requestOtp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OtpRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OtpChallenge"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "AuthController.resendOtp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OtpResend"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OtpChallenge"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "AuthController.verifyOtp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OtpVerify"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OtpVerified"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "AuthController.setPassword": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetPassword"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SignInTicket"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "AuthController.personalSession": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PersonalSessionRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "AuthController.proofOfWork": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProofOfWorkChallenge"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "AuthController.signIn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SignIn"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SignInResult"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "AuthController.tenantOptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TenantOptions"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "BranchesController.list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchList"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "BranchesController.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchDetail"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "BranchesController.update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBranch"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Branch"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "BranchesController.replaceCharges": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReplaceBranchCharges"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchCharges"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "BranchesController.createException": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateHourException"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HourException"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "BranchesController.archiveException": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                exceptionId: components["schemas"]["Id"];
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "BranchesController.updateException": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                exceptionId: components["schemas"]["Id"];
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateHourException"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HourException"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "BranchesController.replaceHours": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReplaceBranchHours"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchHours"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "BranchesController.updateSecurity": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBranchSecurity"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Branch"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "AreasController.list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GovernorateList"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "ConsoleAccountsController.authorizePasswordReset": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AuthorizeAccountPasswordReset"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountPasswordResetAuthorized"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "ConsoleAccountsController.changePhone": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangeAccountPhone"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleAccount"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "ConsoleAccountsController.lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConsoleAccountLookup"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleAccount"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "ConsoleAuthController.reauthenticate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConsoleReauth"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleReauthenticated"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "ConsoleAuthController.setup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConsoleSetup"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleSetUp"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "ConsoleAuthController.signIn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConsoleSignIn"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleSignInResult"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "ConsoleAuthController.signOut": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "ConsoleAuthController.totp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConsoleTotp"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleMe"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "ConsoleMeController.me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleMe"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "ConsoleMeController.changePassword": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePassword"];
            };
        };
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "PlatformUsersController.list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformUserList"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "PlatformUsersController.create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePlatformUser"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformUserSetup"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "PlatformUsersController.update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdatePlatformUser"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformUser"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "PlatformUsersController.reset": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformUserSetup"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenancyConsoleController.list": {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                sort?: "createdAt" | "nameAr";
                order?: components["schemas"]["SortOrder"];
                status?: components["schemas"]["TenantStatus"];
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleTenantPage"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenancyConsoleController.create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTenant"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleTenantDetail"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenancyConsoleController.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleTenantDetail"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenancyConsoleController.createBranch": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateBranch"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Branch"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenancyConsoleController.archiveBranch": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                branchId: components["schemas"]["Id"];
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ArchiveBranch"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Branch"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenancyConsoleController.setSlug": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetTenantSlug"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleTenantDetail"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenancyConsoleController.changeStatus": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TenantStatusRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsoleTenantDetail"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "DevicesController.list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeviceList"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "DevicesController.register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterDevice"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RegisteredDevice"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "DevicesController.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Device"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "DevicesController.rename": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RenameDevice"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Device"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "DevicesController.revoke": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RevokeDevice"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Device"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "DevicesController.members": {
        parameters: {
            query?: {
                knownVersion?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberListResult"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "DevicesController.acknowledge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberListAck"];
            };
        };
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "DevicesController.wiped": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "DevicesController.token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeviceTokenRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeviceToken"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "DevicesController.challenge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeviceTokenChallenge"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Nonce"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "FilesController.read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/png": string;
                    "image/webp": string;
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "HealthCheckController.check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthCheck"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "MapsController.resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResolveMapLink"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Coordinates"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "MeController.get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "MeController.changePassword": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePassword"];
            };
        };
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "MeController.personalDevices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonalDeviceList"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "MeController.revokePersonalDevice": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonalDeviceList"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "MeController.changePin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePin"];
            };
        };
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "SessionsController.open": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OpenSession"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionTokens"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "SessionsController.end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EndSession"];
            };
        };
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "SessionsController.reauthenticate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Reauthenticate"];
            };
        };
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "SessionsController.refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefreshSession"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionTokens"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "StaffController.list": {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                sort?: "displayName" | "createdAt";
                order?: components["schemas"]["SortOrder"];
                status?: components["schemas"]["MembershipStatus"];
                branchId?: components["schemas"]["Id"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffMemberPage"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "StaffController.add": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddStaffMember"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffMember"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "StaffController.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffMember"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "StaffController.changeAccess": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangeStaffAccess"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffMember"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "StaffController.deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeactivateStaffMember"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffMember"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "StaffController.authorizePasswordReset": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "StaffPinController.setPin": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetMemberPin"];
            };
        };
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "StaffController.reactivate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffMember"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenantController.get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Tenant"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenantController.update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateTenant"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Tenant"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenantController.replaceCover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["File"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenantController.removeCover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenantController.replaceLogo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                };
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["File"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenantController.removeLogo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description No content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    "TenantController.completeOnboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Tenant"];
                };
            };
            /** @description Error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}
