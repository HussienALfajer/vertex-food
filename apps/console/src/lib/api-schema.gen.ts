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
    "/api/auth/otp/{challengeId}/delivery": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuthController.otpDelivery"];
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
    "/api/branches/{id}/hub-roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["BranchNetworkController.setRoles"];
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
    "/api/branches/{id}/sync-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["BranchNetworkController.status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
    "/api/console/agreement-templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CatalogConsoleController.templates"];
        put?: never;
        post: operations["CatalogConsoleController.createTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/agreement-templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CatalogConsoleController.updateTemplate"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/agreement-templates/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CatalogConsoleController.archiveTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/amendments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["AgreementsConsoleController.updateAmendment"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/amendments/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AgreementsConsoleController.approve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/amendments/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AgreementsConsoleController.reject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/amendments/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AgreementsConsoleController.submit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/amendments/{id}/unsubmit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AgreementsConsoleController.unsubmit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/amendments/{id}/withdraw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AgreementsConsoleController.withdraw"];
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
    "/api/console/entitlement-overrides/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["EntitlementsConsoleController.revokeOverride"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/feature-catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CatalogConsoleController.catalog"];
        put?: never;
        post?: never;
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
    "/api/console/messaging/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MessagingConsoleController.health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/packages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CatalogConsoleController.packages"];
        put?: never;
        post: operations["CatalogConsoleController.createPackage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/packages/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["CatalogConsoleController.updatePackage"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/packages/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CatalogConsoleController.archivePackage"];
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
    "/api/console/tenants/{id}/agreement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AgreementsConsoleController.agreement"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/tenants/{id}/amendments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AgreementsConsoleController.createAmendment"];
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
    "/api/console/tenants/{id}/entitlement-exceptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["EntitlementsConsoleController.exceptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/tenants/{id}/entitlement-overrides": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["EntitlementsConsoleController.createOverride"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/tenants/{id}/entitlements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["EntitlementsConsoleController.get"];
        put?: never;
        post?: never;
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
    "/api/console/whatsapp-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MessagingConsoleController.list"];
        put?: never;
        post: operations["MessagingConsoleController.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/whatsapp-sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MessagingConsoleController.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/whatsapp-sessions/{id}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MessagingConsoleController.pause"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/whatsapp-sessions/{id}/qr": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MessagingConsoleController.qr"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/whatsapp-sessions/{id}/relink": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MessagingConsoleController.relink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/whatsapp-sessions/{id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MessagingConsoleController.resume"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/console/whatsapp-sessions/{id}/unlink": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MessagingConsoleController.unlink"];
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
    "/api/sync/attention": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SyncStaffController.listAttention"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sync/attention/{id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SyncStaffController.resolveAttention"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sync/certificates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SyncDeviceController.certificate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sync/commands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SyncDeviceController.upload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sync/heartbeat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SyncDeviceController.heartbeat"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sync/number-blocks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SyncDeviceController.numberBlocks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sync/quarantine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SyncStaffController.listQuarantine"];
        put?: never;
        post: operations["SyncDeviceController.uploadQuarantine"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sync/quarantine/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SyncStaffController.quarantineDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sync/quarantine/{id}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SyncStaffController.accept"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sync/quarantine/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SyncStaffController.reject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sync/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SyncDeviceController.token"];
        put?: never;
        post?: never;
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
    "/api/tenant/agreement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TenantAgreementController.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
    "/api/tenant/entitlements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TenantEntitlementsController.get"];
        put?: never;
        post?: never;
        delete?: never;
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
        AgreementTemplate: {
            id: components["schemas"]["Id"];
            code: components["schemas"]["CommercialCode"];
            nameAr: string;
            nameLatin: string | null;
            packageId: components["schemas"]["Id"];
            chargeTerms: components["schemas"]["ChargeTermDraft"][];
            createdAt: components["schemas"]["Instant"];
            updatedAt: components["schemas"]["Instant"];
            archivedAt: components["schemas"]["Instant"] | null;
        };
        AgreementTemplateInput: {
            code: components["schemas"]["CommercialCode"];
            nameAr: string;
            nameLatin?: string | null;
            packageId: components["schemas"]["Id"];
            chargeTerms: components["schemas"]["ChargeTermDraft"][];
        };
        AgreementTemplateList: components["schemas"]["AgreementTemplate"][];
        AgreementTerm: {
            id: components["schemas"]["Id"];
            amendmentId: components["schemas"]["Id"];
            values: components["schemas"]["TermValues"];
            effectiveFrom: components["schemas"]["Instant"] | null;
            effectiveTo: components["schemas"]["Instant"] | null;
            endsAt: components["schemas"]["Instant"] | null;
            endingAmendmentId: components["schemas"]["Id"] | null;
            dueOn: components["schemas"]["LocalDate"] | null;
            listValue: components["schemas"]["TermValues"] | null;
            differenceReason: string | null;
            state: components["schemas"]["TermState"];
            createdAt: components["schemas"]["Instant"];
        };
        Amendment: {
            id: components["schemas"]["Id"];
            tenantId: components["schemas"]["Id"];
            agreementId: components["schemas"]["Id"];
            number: number;
            status: components["schemas"]["AmendmentStatus"];
            changes: components["schemas"]["AmendmentDraftChanges"];
            note: string | null;
            authoredBy: components["schemas"]["Id"] | null;
            authoredByOperator: string | null;
            submittedAt: components["schemas"]["Instant"] | null;
            decidedAt: components["schemas"]["Instant"] | null;
            decidedBy: components["schemas"]["Id"] | null;
            decidedByOperator: string | null;
            decisionReason: string | null;
            applied: {
                terms: components["schemas"]["AgreementTerm"][];
                endings: {
                    termId: components["schemas"]["Id"];
                    endsAt: components["schemas"]["Instant"];
                }[];
            } | null;
            createdAt: components["schemas"]["Instant"];
            updatedAt: components["schemas"]["Instant"];
        };
        AmendmentChanges: components["schemas"]["AmendmentDraftChanges"];
        AmendmentDraftChanges: {
            add: components["schemas"]["TermDraft"][];
            end: components["schemas"]["TermEndingDraft"][];
        };
        /** @enum {string} */
        AmendmentStatus: "draft" | "submitted" | "approved" | "rejected" | "withdrawn";
        AmendmentTransition: {
            updatedAt: components["schemas"]["Instant"];
        };
        ArchiveBranch: {
            note?: string;
        };
        ArchivePreset: {
            updatedAt: components["schemas"]["Instant"];
        };
        AttentionItem: {
            id: components["schemas"]["Id"];
            branchId: components["schemas"]["Id"];
            commandId: components["schemas"]["Id"];
            kind: components["schemas"]["AttentionKind"];
            membershipId: components["schemas"]["Id"] | null;
            createdAt: components["schemas"]["Instant"];
            command: {
                name: components["schemas"]["CommandName"];
                summary: components["schemas"]["CommandSummary"];
                outcome: components["schemas"]["CommandOutcome"];
                reason: components["schemas"]["CommandReason"] | null;
                details: {
                    [key: string]: unknown;
                } | null;
                receivedAt: components["schemas"]["Instant"];
            };
            resolution: {
                reason: string;
                resolvedByMembershipId: components["schemas"]["Id"];
                resolvedAt: components["schemas"]["Instant"];
            } | null;
        };
        /** @enum {string} */
        AttentionKind: "adjusted" | "rejected" | "replay_mismatch" | "number_taken" | "clock_suspect" | "server_error";
        AttentionPage: {
            items: components["schemas"]["AttentionItem"][];
            total: number;
            page: number;
            pageSize: number;
        };
        /** @enum {string} */
        AuditAction: "tenant.created" | "tenant.profile_updated" | "tenant.slug_changed" | "tenant.status_scheduled" | "tenant.status_changed" | "tenant.status_schedule_cancelled" | "tenant.status_rescheduled" | "tenant.onboarding_completed" | "tenant_logo.replaced" | "tenant_logo.archived" | "tenant_cover.replaced" | "tenant_cover.archived" | "branch.created" | "branch.updated" | "branch.archived" | "branch_hours.replaced" | "branch_hour_exception.created" | "branch_hour_exception.updated" | "branch_hour_exception.archived" | "branch_charges.replaced" | "governorate.created" | "city.created" | "staff.added" | "staff.access_changed" | "staff.deactivated" | "staff.reactivated" | "staff.password_reset_authorized" | "staff_pin.set" | "staff_pin.disabled" | "device.registered" | "device.renamed" | "device.revoked" | "device.wiped" | "staff_session.started" | "staff_session.reauthenticated" | "branch.security_updated" | "account.created" | "account.password_set" | "account.password_reset_authorized" | "account.phone_changed" | "account.sign_in_locked" | "personal_device.added" | "personal_device.revoked" | "console.request" | "platform_user.created" | "platform_user.updated" | "platform_user.disabled" | "platform_user.reset" | "platform_user.setup_completed" | "platform_user.signed_in" | "platform_user.signed_out" | "platform_user.sign_in_failed" | "platform_user.totp_failed" | "platform_user.reauthenticated" | "platform_user.password_changed" | "whatsapp_session.created" | "whatsapp_session.relinked" | "whatsapp_session.paused" | "whatsapp_session.resumed" | "whatsapp_session.unlinked" | "branch.hub_roles_changed" | "branch_ca.created" | "device_certificate.issued" | "quarantine_batch.received" | "quarantine_batch.accepted" | "quarantine_batch.rejected" | "attention_item.resolved" | "hub.promoted" | "hub.demoted" | "hub.rejoined" | "hub.divergence_adopted" | "hub_pairing.opened" | "hub_pairing.paired" | "hub_pairing.revoked" | "hub_pairing.expired" | "hub_session.pin_locked" | "sync.network_check_run" | "staff_pin.failed_offline" | "staff_pin.locked_offline" | "staff_pin.reenabled_offline" | "staff_approval.granted" | "package.created" | "package.updated" | "package.archived" | "agreement_template.created" | "agreement_template.updated" | "agreement_template.archived" | "amendment.created" | "amendment.updated" | "amendment.submitted" | "amendment.unsubmitted" | "amendment.withdrawn" | "amendment.approved" | "amendment.rejected" | "entitlement_override.created" | "entitlement_override.revoked" | "agreement.amended" | "entitlements.overridden" | "data_export.requested" | "data_export.completed" | "data_export.failed" | "data_export.downloaded" | "data_export.expired";
        /** @enum {string} */
        AuditActorKind: "staff" | "customer" | "driver" | "platform" | "system";
        /** @enum {string} */
        AuditCategory: "access" | "devices" | "settings" | "agreement" | "data" | "money" | "menu_prices" | "support";
        AuditCursor: string;
        AuditDetail: {
            field: string;
            change: boolean;
            before?: unknown;
            after?: unknown;
            value?: unknown;
        };
        AuditEntry: {
            id: components["schemas"]["Id"];
            action: components["schemas"]["AuditAction"];
            category: components["schemas"]["AuditCategory"];
            actor: {
                kind: components["schemas"]["AuditShownActorKind"];
                accountId: components["schemas"]["Id"] | null;
                name: string | null;
                roles: components["schemas"]["StaffRole"][];
            };
            entity: {
                type: string;
                id: string | null;
                name: string | null;
            };
            branch: {
                id: components["schemas"]["Id"];
                name: string;
                archived: boolean;
            } | null;
            device: {
                id: components["schemas"]["Id"];
                name: string | null;
            } | null;
            reason: string | null;
            details: components["schemas"]["AuditDetail"][];
            recordedOffline: boolean;
            occurredAt: components["schemas"]["Instant"];
            createdAt: components["schemas"]["Instant"];
        };
        AuditPage: {
            items: components["schemas"]["AuditEntry"][];
            nextCursor: components["schemas"]["AuditCursor"] | null;
        };
        AuditQuery: {
            from?: components["schemas"]["LocalDate"];
            to?: components["schemas"]["LocalDate"];
            category?: components["schemas"]["AuditCategory"] | components["schemas"]["AuditCategory"][];
            branchId?: components["schemas"]["Id"];
            /** @enum {string} */
            tenantWide?: "true" | "false";
            actorAccountId?: components["schemas"]["Id"];
            before?: components["schemas"]["AuditCursor"];
        };
        /** @enum {string} */
        AuditShownActorKind: "staff" | "vertex" | "system" | "device" | "customer" | "driver";
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
            salesChannels: components["schemas"]["SalesChannel"][];
            position: number;
        };
        BranchChargeInput: {
            kind: components["schemas"]["ChargeKind"];
            nameAr: string;
            nameLatin?: string | null;
            rateBp: number;
            mode: components["schemas"]["ChargeMode"];
            salesChannels: components["schemas"]["SalesChannel"][];
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
        BranchPc: {
            deviceId: components["schemas"]["Id"];
            name: string;
            hubRole: components["schemas"]["HubRole"] | null;
            sync: {
                lastHeartbeatAt: components["schemas"]["Instant"];
                liveRole: components["schemas"]["LiveRole"];
                hubEpoch: number;
                standbyInSync: boolean | null;
                pendingUploads: number;
                appVersion: string;
                protocol: number;
                lanAddresses: string[];
                recentRoundTripsMs: number[];
                clockOffsetMs: number | null;
            } | null;
            certificate: {
                fingerprint: components["schemas"]["Sha256Hex"];
                lanAddresses: string[];
                expiresAt: components["schemas"]["Instant"];
            } | null;
        };
        BranchScope: {
            /** @constant */
            allBranches: true;
        } | {
            /** @constant */
            allBranches: false;
            branchIds: components["schemas"]["Id"][];
        };
        BranchSyncStatus: {
            branchId: components["schemas"]["Id"];
            connectivity: {
                state: components["schemas"]["ConnectivityState"];
                since: components["schemas"]["Instant"];
            };
            pcs: components["schemas"]["BranchPc"][];
        };
        BusinessDayEnd: string;
        CancelScheduledTenantStatus: {
            /** @constant */
            cancelScheduled: true;
            note?: string;
        };
        CatalogFeature: {
            key: components["schemas"]["EntitlementKey"];
            dependsOn: components["schemas"]["EntitlementKey"][][];
            private: boolean;
            retired: boolean;
        };
        CatalogLimit: {
            key: components["schemas"]["EntitlementKey"];
            counts: string;
            retired: boolean;
        };
        CertificateRequest: {
            csr: string;
            lanAddresses: components["schemas"]["LanAddresses"];
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
        ChargeBasis: "tenant" | "active_branch";
        /** @enum {string} */
        ChargeKind: "tax" | "service";
        /** @enum {string} */
        ChargeMode: "inclusive" | "added";
        ChargeTermDraft: {
            /** @constant */
            kind: "subscription";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            period: components["schemas"]["RecurringPeriod"];
            per: components["schemas"]["ChargeBasis"];
        } | {
            /** @constant */
            kind: "listing_fee";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            period: components["schemas"]["RecurringPeriod"];
            per: components["schemas"]["ChargeBasis"];
        } | {
            /** @constant */
            kind: "commission";
            channel: components["schemas"]["CommissionChannel"];
            percentBp: number;
            fixed?: {
                amount: number;
                currency: components["schemas"]["CurrencyCode"];
            };
        } | {
            /** @constant */
            kind: "delivery_fee_share";
            percentBp: number;
        } | {
            /** @constant */
            kind: "setup_fee";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            label: string;
        } | {
            /** @constant */
            kind: "hardware";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            label: string;
        } | {
            /** @constant */
            kind: "service";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            label: string;
        };
        City: {
            id: components["schemas"]["Id"];
            governorateId: components["schemas"]["Id"];
            nameAr: string;
            nameLatin: string;
            archivedAt: components["schemas"]["Instant"] | null;
        };
        CommandActor: {
            /** @constant */
            kind: "member";
            membershipId: components["schemas"]["Id"];
            /** @enum {string} */
            sessionKind: "pc" | "hub_client";
        } | {
            /** @constant */
            kind: "station";
            pairingId: components["schemas"]["Id"];
        } | {
            /** @constant */
            kind: "device";
        };
        CommandEnvelope: {
            id: components["schemas"]["Id"];
            name: components["schemas"]["CommandName"];
            version: components["schemas"]["CommandVersion"];
            protocol: number;
            originKind: components["schemas"]["CommandOriginKind"];
            originDeviceId: components["schemas"]["Id"];
            executedByDeviceId: components["schemas"]["Id"];
            actor: components["schemas"]["CommandActor"];
            approvedByMembershipId?: components["schemas"]["Id"];
            deviceTime: components["schemas"]["Instant"];
            clockOffsetMs: number;
            highestSeenTime: components["schemas"]["Instant"];
            afterOfflineWindow: boolean;
            hubEpoch: number;
            hubSeq: number;
            payload: {
                [key: string]: unknown;
            };
            resolved: {
                [key: string]: unknown;
            };
            payloadHash: components["schemas"]["Sha256Hex"];
            signature: components["schemas"]["Signature"];
        };
        /** @enum {string} */
        CommandFlag: "clock_suspect" | "after_offline_window" | "from_quarantine" | "mirrored_false";
        CommandName: string;
        /** @enum {string} */
        CommandOriginKind: "pc" | "hub_client";
        /** @enum {string} */
        CommandOutcome: "accepted" | "adjusted" | "rejected";
        /** @enum {string} */
        CommandReason: "payload_invalid" | "permission_missing" | "pin_session_ended" | "station_not_allowed" | "unknown_command" | "version_unsupported" | "protocol_unsupported" | "signature_invalid" | "device_revoked" | "member_inactive" | "approver_not_allowed" | "number_out_of_block" | "server_error" | "not_entitled";
        CommandResult: {
            id: components["schemas"]["Id"];
            /** @enum {string} */
            outcome: "accepted" | "adjusted" | "rejected" | "quarantined";
            reason?: components["schemas"]["CommandReason"];
            details?: {
                [key: string]: unknown;
            };
            replay: boolean;
        };
        CommandSummary: {
            key: string;
            params: {
                [key: string]: string | number;
            };
        };
        CommandVersion: number;
        CommercialCode: string;
        /** @enum {string} */
        CommissionChannel: "marketplace" | "web";
        /** @enum {string} */
        ConnectivityState: "online" | "weak" | "offline";
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
        ConsoleAgreement: {
            tenantId: components["schemas"]["Id"];
            agreement: {
                id: components["schemas"]["Id"];
                templateId: components["schemas"]["Id"] | null;
                inForce: boolean;
                createdAt: components["schemas"]["Instant"];
            } | null;
            terms: components["schemas"]["AgreementTerm"][];
            amendments: components["schemas"]["Amendment"][];
            overrides: components["schemas"]["EntitlementOverride"][];
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
        ConsolePermission: "console.tenants.manage" | "console.tenants.status" | "console.users.manage" | "console.accounts.recover" | "console.messaging.read" | "console.messaging.manage" | "console.agreements.read" | "console.agreements.draft" | "console.agreements.approve" | "console.entitlements.override" | "console.catalog.manage" | "console.audit.read";
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
        CreateAmendment: {
            templateId?: components["schemas"]["Id"];
            changes?: components["schemas"]["AmendmentDraftChanges"];
            note?: string;
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
        CreatePlatformWhatsAppSession: {
            label: string;
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
        DataExport: {
            id: components["schemas"]["Id"];
            status: components["schemas"]["DataExportStatus"];
            /** @constant */
            formatVersion: 1;
            requestedBy: {
                accountId: components["schemas"]["Id"];
                name: string | null;
            };
            requestedAt: components["schemas"]["Instant"];
            startedAt: components["schemas"]["Instant"] | null;
            finishedAt: components["schemas"]["Instant"] | null;
            asOf: components["schemas"]["Instant"] | null;
            expiresAt: components["schemas"]["Instant"] | null;
            failure: components["schemas"]["DataExportFailure"] | null;
            fileName: string | null;
            byteSize: number | null;
            rowCounts: {
                [key: string]: number;
            } | null;
        };
        /** @enum {string} */
        DataExportFailure: "too_large" | "timed_out" | "server_error";
        DataExportLink: {
            url: string;
            expiresAt: components["schemas"]["Instant"];
        };
        DataExportListQuery: {
            before?: components["schemas"]["Id"];
        };
        DataExportPage: {
            items: components["schemas"]["DataExport"][];
            nextBefore: components["schemas"]["Id"] | null;
            remainingToday: number;
            nextAllowedAt: components["schemas"]["Instant"] | null;
        };
        /** @enum {string} */
        DataExportStatus: "queued" | "running" | "ready" | "failed" | "expired";
        DataExportToken: string;
        DeactivateStaffMember: {
            reason: string;
        };
        DecisionReason: string;
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
        EntitlementException: {
            id: components["schemas"]["Id"];
            tenantId: components["schemas"]["Id"];
            branchId: components["schemas"]["Id"];
            deviceId: components["schemas"]["Id"];
            commandId: components["schemas"]["Id"];
            featureKey: components["schemas"]["EntitlementKey"];
            effectiveAt: components["schemas"]["Instant"];
            recordedAt: components["schemas"]["Instant"];
        };
        EntitlementExceptionPage: {
            items: components["schemas"]["EntitlementException"][];
            nextBefore: components["schemas"]["Id"] | null;
        };
        EntitlementExceptionsQuery: {
            before?: components["schemas"]["Id"];
        };
        EntitlementKey: string;
        EntitlementOverride: {
            id: components["schemas"]["Id"];
            tenantId: components["schemas"]["Id"];
            kind: components["schemas"]["OverrideKind"];
            featureKey: components["schemas"]["EntitlementKey"] | null;
            limitKey: components["schemas"]["EntitlementKey"] | null;
            value: number | null;
            reason: string;
            startsAt: components["schemas"]["Instant"];
            expiresAt: components["schemas"]["Instant"] | null;
            createdBy: components["schemas"]["Id"] | null;
            createdByOperator: string | null;
            createdAt: components["schemas"]["Instant"];
            revocation: components["schemas"]["EntitlementOverrideRevocation"] | null;
        };
        EntitlementOverrideRevocation: {
            overrideId: components["schemas"]["Id"];
            revokedAt: components["schemas"]["Instant"];
            reason: string;
            revokedBy: components["schemas"]["Id"] | null;
            revokedByOperator: string | null;
            createdAt: components["schemas"]["Instant"];
        };
        Entitlements: {
            version: number;
            at: components["schemas"]["Instant"];
            features: components["schemas"]["ResolvedFeature"][];
            limits: components["schemas"]["LimitUsage"][];
            validUntil: components["schemas"]["Instant"] | null;
        };
        /** @enum {string} */
        EntitlementSource: "override" | "agreement" | "default";
        EntitlementsQuery: {
            at?: components["schemas"]["Instant"];
        };
        /** @enum {string} */
        ErrorCode: "VALIDATION_FAILED" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_ENTITLED" | "TENANT_SUSPENDED" | "TENANT_CLOSED" | "NOT_FOUND" | "CONFLICT" | "INVALID_STATUS_TRANSITION" | "LAST_ACTIVE_BRANCH" | "SLUG_TAKEN" | "BRANCH_CURRENCY_LOCKED" | "CURRENCY_MISMATCH" | "INVALID_AMOUNT" | "ONBOARDING_INCOMPLETE" | "FILE_REJECTED" | "MAP_LINK_UNRECOGNIZED" | "SLUG_RESERVED" | "INVALID_HOURS" | "RATE_LIMITED" | "INTERNAL_ERROR" | "SERVICE_UNAVAILABLE" | "INVALID_CREDENTIALS" | "TICKET_INVALID" | "SESSION_ENDED" | "SIGNATURE_INVALID" | "DEVICE_UNKNOWN" | "INVALID_PIN" | "DEVICE_REVOKED" | "MEMBERSHIP_INACTIVE" | "BRANCH_NOT_IN_SCOPE" | "REAUTH_REQUIRED" | "DEVICE_REQUIRED" | "PIN_DISABLED" | "APPROVER_NOT_ALLOWED" | "OFFLINE_WINDOW_EXPIRED" | "POW_INVALID" | "OTP_INVALID" | "OTP_EXPIRED" | "OTP_ATTEMPTS_EXCEEDED" | "OTP_COOLDOWN" | "PASSWORD_TOO_WEAK" | "PIN_TOO_WEAK" | "TOTP_INVALID" | "PERMISSION_NOT_GRANTABLE" | "ALREADY_MEMBER" | "LAST_OWNER" | "LAST_ADMIN" | "BRANCH_HAS_DEVICES" | "BRANCH_HAS_MEMBERS" | "OTP_DELIVERY_UNAVAILABLE" | "WHATSAPP_SESSION_LIMIT" | "PROTOCOL_UNSUPPORTED" | "UPDATE_REQUIRED" | "DEVICE_NOT_HUB_CAPABLE" | "DEVICE_NOT_REVOKED" | "HUB_ROLE_ACTIVE" | "CERTIFICATE_ADDRESS_INVALID" | "ATTENTION_ALREADY_RESOLVED" | "QUARANTINE_ALREADY_DECIDED" | "PAIRING_CLOSED" | "PAIRING_CODE_INVALID" | "PAIRING_LOCKED" | "NOT_HUB" | "ENTITLEMENT_LIMIT_REACHED" | "AGREEMENT_NOT_IN_FORCE" | "AMENDMENT_OPEN" | "SELF_APPROVAL" | "TERM_OVERLAP" | "EFFECTIVE_DATE_PAST" | "FEATURE_DEPENDENCY_MISSING" | "OVERRIDE_OVERLAP" | "ALREADY_REVOKED" | "CODE_TAKEN" | "EXPORT_IN_PROGRESS" | "EXPORT_LIMIT_REACHED" | "EXPORT_NOT_READY";
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
        /** @enum {string} */
        ExportColumnKind: "text" | "integer" | "money" | "instant" | "date" | "boolean" | "list";
        ExportManifest: {
            /** @constant */
            formatVersion: 1;
            /** Format: uuid */
            tenantId: string;
            slug: string;
            /** Format: date-time */
            asOf: string;
            /** Format: date-time */
            generatedAt: string;
            files: {
                path: string;
                rows: number | null;
                sha256: string;
            }[];
        };
        FeatureCatalog: {
            features: components["schemas"]["CatalogFeature"][];
            limits: components["schemas"]["CatalogLimit"][];
        };
        /** @enum {string} */
        FeatureKey: "custom_domain" | "custom_fields" | "pos" | "kitchen_display" | "waiter_app" | "order_intake" | "web_ordering" | "restaurant_delivery" | "vertex_delivery" | "promotions" | "loyalty" | "analytics" | "marketplace_listing";
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
        Heartbeat: {
            lastRoundTripMs: number | null;
            pendingUploads: number;
            liveRole: components["schemas"]["LiveRole"];
            hubEpoch: number;
            standbyInSync: boolean | null;
            appVersion: string;
            protocol: number;
            lanAddresses: components["schemas"]["LanAddresses"];
            clockOffsetMs: number | null;
        };
        HeartbeatAnswer: {
            serverTime: components["schemas"]["Instant"];
            connectivity: components["schemas"]["ConnectivityState"];
            minimumAppVersion: string;
            protocols: number[];
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
        HubCommand: {
            id: components["schemas"]["Id"];
            name: components["schemas"]["CommandName"];
            version: components["schemas"]["CommandVersion"];
            payload: {
                [key: string]: unknown;
            };
            deviceTime: components["schemas"]["Instant"];
            actor?: components["schemas"]["CommandActor"];
            approvedByMembershipId?: components["schemas"]["Id"];
            afterOfflineWindow?: boolean;
            resent?: components["schemas"]["CommandEnvelope"];
        };
        HubCommandAnswer: {
            /** @constant */
            status: "ok";
            mirrored: boolean;
            envelope: components["schemas"]["CommandEnvelope"];
        } | {
            /** @constant */
            status: "duplicate";
            mirrored: boolean;
            envelope: components["schemas"]["CommandEnvelope"];
        } | {
            /** @constant */
            status: "refused";
            reason: components["schemas"]["HubRefusalReason"];
        } | {
            /** @constant */
            status: "not_hub";
            epoch: number;
            hubDeviceId: components["schemas"]["Id"] | null;
        };
        HubHello: {
            deviceId: components["schemas"]["Id"];
            role: components["schemas"]["LiveRole"];
            epoch: number;
            protocol: number;
            appVersion: string;
        };
        HubLiveSnapshot: {
            hub: {
                deviceId: components["schemas"]["Id"];
                role: components["schemas"]["LiveRole"];
                epoch: number;
                /** @enum {string} */
                standby: "in_sync" | "not_in_sync" | "none";
                connectivity: components["schemas"]["ConnectivityState"];
            };
            clients: components["schemas"]["HubPairing"][];
            networkChecks: components["schemas"]["NetworkCheckRecord"][];
        };
        HubMembers: {
            members: {
                membershipId: components["schemas"]["Id"];
                name: string;
                roles: components["schemas"]["StaffRole"][];
            }[];
        };
        HubPairing: {
            id: components["schemas"]["Id"];
            kind: components["schemas"]["PairingKind"];
            name: string;
            createdAt: components["schemas"]["Instant"];
            lastUsedAt: components["schemas"]["Instant"];
        };
        HubPairRequest: {
            code: components["schemas"]["PairingCode"];
        };
        HubPairResult: {
            token: string;
            pairingId: components["schemas"]["Id"];
            kind: components["schemas"]["PairingKind"];
            peers: string[];
            caFingerprint: components["schemas"]["Sha256Hex"];
        };
        /** @enum {string} */
        HubRefusalReason: "payload_invalid" | "permission_missing" | "pin_session_ended" | "station_not_allowed" | "unknown_command" | "version_unsupported" | "not_entitled";
        /** @enum {string} */
        HubRole: "hub" | "standby";
        HubSession: {
            token: string;
            membershipId: components["schemas"]["Id"];
            name: string;
            permissions: components["schemas"]["StaffPermission"][];
            idleLockMinutes: number;
            expiresAt: components["schemas"]["Instant"];
        };
        HubSessionRequest: {
            membershipId: components["schemas"]["Id"];
            pin: components["schemas"]["Pin"];
        };
        /** Format: uuid */
        Id: string;
        IdleLockMinutes: number;
        /** Format: date-time */
        Instant: string;
        IssuedCertificate: {
            certificate: string;
            caCertificate: string;
            fingerprint: components["schemas"]["Sha256Hex"];
        };
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
        LanAddresses: string[];
        /** @enum {string} */
        LimitKey: "branches" | "devices" | "staff" | "catalog_items" | "custom_field_definitions";
        LimitUsage: {
            key: components["schemas"]["EntitlementKey"];
            value: number | null;
            source: components["schemas"]["EntitlementSource"];
            usage: number;
        };
        ListAttentionQuery: {
            /** @default 1 */
            page: number;
            /** @default 50 */
            pageSize: number;
            /** @enum {string} */
            sort?: "createdAt";
            /** @default asc */
            order: components["schemas"]["SortOrder"];
            branchId: components["schemas"]["Id"];
            /**
             * @default open
             * @enum {string}
             */
            status: "open" | "closed" | "all";
            kind?: components["schemas"]["AttentionKind"];
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
        ListPresetsQuery: {
            /** @enum {string} */
            includeArchived?: "true" | "false";
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
        /** @enum {string} */
        LiveRole: "hub" | "standby" | "client" | "rejoining";
        /** Format: date */
        LocalDate: string;
        /** @enum {string} */
        LocalEventAction: "hub.promoted" | "hub.demoted" | "hub.rejoined" | "hub.divergence_adopted" | "hub_pairing.opened" | "hub_pairing.paired" | "hub_pairing.revoked" | "hub_pairing.expired" | "hub_session.pin_locked" | "sync.network_check_run" | "staff_pin.failed_offline" | "staff_pin.locked_offline" | "staff_pin.reenabled_offline" | "staff_approval.granted";
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
        MessagingHealth: {
            healthy: number;
            total: number;
            otpAvailable: boolean;
        };
        MissingOnboardingItem: {
            item: components["schemas"]["OnboardingItem"];
            branchId: components["schemas"]["Id"] | null;
        };
        MobilePhoneNumber: components["schemas"]["PhoneNumber"];
        Money: {
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
        };
        NetworkCheckRecord: {
            commandId: components["schemas"]["Id"];
            run: components["schemas"]["Id"];
            sequence: number;
            originDeviceId: components["schemas"]["Id"];
            sentAt: components["schemas"]["Instant"];
            receivedAt: components["schemas"]["Instant"];
            mirroredAt: components["schemas"]["Instant"] | null;
            committedAt: components["schemas"]["Instant"];
        };
        NoContent: null;
        Nonce: {
            nonce: string;
            expiresAt: components["schemas"]["Instant"];
        };
        NumberBlock: {
            businessDate: components["schemas"]["LocalDate"];
            first: number;
            last: number;
        };
        NumberBlocks: {
            series: components["schemas"]["NumberSeries"];
            blocks: components["schemas"]["NumberBlock"][];
        };
        NumberBlocksRequest: {
            series: components["schemas"]["NumberSeries"];
        };
        /** @enum {string} */
        NumberSeries: "order";
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
        OpenPairing: {
            kind: components["schemas"]["PairingKind"];
            name: components["schemas"]["PairingName"];
        };
        OpenSession: {
            membershipId: components["schemas"]["Id"];
            pin: components["schemas"]["Pin"];
        } | {
            membershipId: components["schemas"]["Id"];
            ticket: string;
        };
        OtpChallenge: {
            challengeId: components["schemas"]["Id"];
        };
        OtpCode: string;
        OtpDelivery: {
            status: components["schemas"]["OtpDeliveryStatus"];
        };
        /** @enum {string} */
        OtpDeliveryStatus: "queued" | "sent" | "delivered" | "failed" | "unknown";
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
        OverrideInput: {
            /** @constant */
            kind: "grant";
            featureKey: components["schemas"]["EntitlementKey"];
            reason: string;
            startsAt?: components["schemas"]["TermDate"];
            expiresAt?: components["schemas"]["LocalDate"];
        } | {
            /** @constant */
            kind: "deny";
            featureKey: components["schemas"]["EntitlementKey"];
            reason: string;
            startsAt?: components["schemas"]["TermDate"];
            expiresAt?: components["schemas"]["LocalDate"];
        } | {
            /** @constant */
            kind: "limit";
            limitKey: components["schemas"]["EntitlementKey"];
            value: number;
            reason: string;
            startsAt?: components["schemas"]["TermDate"];
            expiresAt?: components["schemas"]["LocalDate"];
        };
        /** @enum {string} */
        OverrideKind: "grant" | "deny" | "limit";
        Package: {
            id: components["schemas"]["Id"];
            code: components["schemas"]["CommercialCode"];
            nameAr: string;
            nameLatin: string | null;
            features: components["schemas"]["EntitlementKey"][];
            limits: {
                [key: string]: number;
            };
            createdAt: components["schemas"]["Instant"];
            updatedAt: components["schemas"]["Instant"];
            archivedAt: components["schemas"]["Instant"] | null;
        };
        PackageInput: {
            code: components["schemas"]["CommercialCode"];
            nameAr: string;
            nameLatin?: string | null;
            features: components["schemas"]["EntitlementKey"][];
            limits: {
                [key: string]: number;
            };
        };
        PackageList: components["schemas"]["Package"][];
        PairingCode: string;
        /** @enum {string} */
        PairingKind: "station" | "personal";
        PairingName: string;
        Password: string;
        /** @enum {string} */
        PermissionGroup: "tenant" | "branch" | "staff" | "devices" | "sync";
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
        PlatformAuditEntry: {
            id: components["schemas"]["Id"];
            action: components["schemas"]["AuditAction"];
            actor: {
                /** @enum {string} */
                kind: "platform" | "staff" | "system";
                id: components["schemas"]["Id"] | null;
                name: string | null;
            };
            entityType: string;
            entityId: string | null;
            subjectTenant: {
                id: components["schemas"]["Id"];
                slug: string;
                nameAr: string;
            } | null;
            requestRoute: string | null;
            reason: string | null;
            details: {
                [key: string]: unknown;
            } | null;
            occurredAt: components["schemas"]["Instant"];
            createdAt: components["schemas"]["Instant"];
        };
        PlatformAuditPage: {
            items: components["schemas"]["PlatformAuditEntry"][];
            nextCursor: components["schemas"]["AuditCursor"] | null;
        };
        PlatformAuditQuery: {
            from?: components["schemas"]["LocalDate"];
            to?: components["schemas"]["LocalDate"];
            actorUserId?: components["schemas"]["Id"];
            action?: components["schemas"]["AuditAction"];
            subjectTenantId?: components["schemas"]["Id"];
            entityId?: components["schemas"]["Id"];
            before?: components["schemas"]["AuditCursor"];
        };
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
        PlatformWhatsAppSession: {
            id: components["schemas"]["Id"];
            label: string;
            phone: string | null;
            state: components["schemas"]["WhatsAppSessionState"];
            pausedAt: components["schemas"]["Instant"] | null;
            pauseReason: components["schemas"]["WhatsAppPauseReason"] | null;
            linkedAt: components["schemas"]["Instant"] | null;
            warmUpDay: number | null;
            sentLast24h: number;
            dailyCap: number;
            firstContactsLast24h: number;
            firstContactCap: number;
            sentLastHour: number;
            hourlyCap: number;
            lastConnectedAt: components["schemas"]["Instant"] | null;
            leaseHeld: boolean;
            healthy: boolean;
            createdAt: components["schemas"]["Instant"];
            updatedAt: components["schemas"]["Instant"];
        };
        PlatformWhatsAppSessionList: components["schemas"]["PlatformWhatsAppSession"][];
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
        QuarantineBatch: {
            id: components["schemas"]["Id"];
            branchId: components["schemas"]["Id"];
            deviceId: components["schemas"]["Id"];
            deviceName: string;
            reason: components["schemas"]["QuarantineReason"];
            membershipId: components["schemas"]["Id"] | null;
            commandCount: number;
            createdAt: components["schemas"]["Instant"];
            decision: components["schemas"]["QuarantineDecision"] | null;
        };
        QuarantineBatchDetail: {
            batch: components["schemas"]["QuarantineBatch"];
            commands: components["schemas"]["QuarantineCommand"][];
        };
        QuarantineBatchList: components["schemas"]["QuarantineBatch"][];
        QuarantineCommand: {
            commandId: components["schemas"]["Id"];
            name: components["schemas"]["CommandName"];
            summary: components["schemas"]["CommandSummary"];
            deviceTime: components["schemas"]["Instant"];
            hubEpoch: number;
            hubSeq: number;
            alreadyExecuted: boolean;
        };
        QuarantineDecision: {
            /** @enum {string} */
            decision: "accept" | "reject";
            reason: string | null;
            decidedByMembershipId: components["schemas"]["Id"];
            decidedAt: components["schemas"]["Instant"];
        };
        QuarantineDecisionResult: {
            batch: components["schemas"]["QuarantineBatch"];
            results: components["schemas"]["CommandResult"][];
        };
        /** @enum {string} */
        QuarantineReason: "device_revoked" | "member_inactive";
        QuarantineUpload: {
            tenantId: components["schemas"]["Id"];
            deviceId: components["schemas"]["Id"];
            nonce: string;
            signature: components["schemas"]["Signature"];
            protocol: number;
            commands: components["schemas"]["CommandEnvelope"][];
        };
        QuarantineUploadResult: {
            batchId: components["schemas"]["Id"];
        };
        Reauthenticate: {
            password: string;
        };
        RecoveryCode: string;
        /** @enum {string} */
        RecurringPeriod: "month" | "year";
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
        RejectAmendment: {
            reason: string;
            updatedAt: components["schemas"]["Instant"];
        };
        RejectQuarantine: {
            reason: components["schemas"]["DecisionReason"];
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
        ResolveAttention: {
            reason: components["schemas"]["DecisionReason"];
        };
        ResolvedEntitlements: {
            at: components["schemas"]["Instant"];
            features: components["schemas"]["ResolvedFeature"][];
            limits: components["schemas"]["ResolvedLimit"][];
            validUntil: components["schemas"]["Instant"] | null;
        };
        ResolvedFeature: {
            key: components["schemas"]["EntitlementKey"];
            on: boolean;
            source: components["schemas"]["EntitlementSource"];
            reason: "dependency_missing" | null;
            until: components["schemas"]["Instant"] | null;
        };
        ResolvedLimit: {
            key: components["schemas"]["EntitlementKey"];
            value: number | null;
            source: components["schemas"]["EntitlementSource"];
        };
        ResolveMapLink: {
            /** Format: uri */
            url: string;
        };
        RevokeDevice: {
            reason: components["schemas"]["DeviceRevokeReason"];
            note?: string;
        };
        RevokeEntitlementOverride: {
            reason: string;
        };
        /** @enum {string} */
        SalesChannel: "dine_in" | "takeaway" | "delivery" | "pickup";
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
        SetHubRoles: {
            hubDeviceId: components["schemas"]["Id"];
            standbyDeviceId?: components["schemas"]["Id"];
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
        Sha256Hex: string;
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
        StaffPermission: "tenant.view" | "tenant.profile.edit" | "branch.settings.edit" | "branch.hours.edit" | "branch.security.edit" | "staff.view" | "staff.manage" | "staff.permissions.adjust" | "devices.manage" | "backoffice.remote" | "hub.manage" | "sync.attention.resolve" | "sync.quarantine.review" | "agreement.view" | "audit.view" | "data.export";
        /** @enum {string} */
        StaffRole: "owner" | "manager" | "cashier" | "waiter" | "kitchen" | "driver";
        /** @enum {string} */
        StaffSessionEndReason: "signed_out" | "locked" | "idle" | "expired" | "member_deactivated" | "branch_left" | "device_revoked" | "password_reset" | "tenant_closed" | "refresh_reused" | "access_lost";
        /** @enum {string} */
        StaffSessionKind: "device" | "personal";
        SyncToken: {
            token: string;
            expiresAt: components["schemas"]["Instant"];
            /** Format: uri */
            endpoint: string;
        };
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
        TenantAgreement: {
            at: components["schemas"]["Instant"];
            features: {
                key: components["schemas"]["EntitlementKey"];
                on: boolean;
                source: components["schemas"]["EntitlementSource"];
                reason: "dependency_missing" | null;
                until: components["schemas"]["Instant"] | null;
                private: boolean;
            }[];
            limits: components["schemas"]["LimitUsage"][];
            charges: {
                id: components["schemas"]["Id"];
                values: components["schemas"]["TermValues"];
                effectiveFrom: components["schemas"]["Instant"];
                endsAt: components["schemas"]["Instant"] | null;
                /** @enum {string} */
                state: "in_force" | "scheduled";
            }[];
            oneOffFees: {
                id: components["schemas"]["Id"];
                values: components["schemas"]["TermValues"];
                dueOn: components["schemas"]["LocalDate"];
            }[];
            amendments: {
                number: number;
                approvedAt: components["schemas"]["Instant"];
            }[];
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
        TermDate: "now" | components["schemas"]["LocalDate"];
        TermDraft: {
            /** @constant */
            kind: "feature";
            featureKey: components["schemas"]["EntitlementKey"];
            effectiveFrom: components["schemas"]["TermDate"];
            effectiveTo?: components["schemas"]["LocalDate"];
        } | {
            /** @constant */
            kind: "limit";
            limitKey: components["schemas"]["EntitlementKey"];
            value: number;
            effectiveFrom: components["schemas"]["TermDate"];
            effectiveTo?: components["schemas"]["LocalDate"];
        } | {
            /** @constant */
            kind: "subscription";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            period: components["schemas"]["RecurringPeriod"];
            per: components["schemas"]["ChargeBasis"];
            effectiveFrom: components["schemas"]["TermDate"];
            effectiveTo?: components["schemas"]["LocalDate"];
            listValue: {
                /** @constant */
                kind: "subscription";
                amount: number;
                currency: components["schemas"]["CurrencyCode"];
                period: components["schemas"]["RecurringPeriod"];
                per: components["schemas"]["ChargeBasis"];
            } | null;
            differenceReason?: string;
        } | {
            /** @constant */
            kind: "listing_fee";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            period: components["schemas"]["RecurringPeriod"];
            per: components["schemas"]["ChargeBasis"];
            effectiveFrom: components["schemas"]["TermDate"];
            effectiveTo?: components["schemas"]["LocalDate"];
            listValue: {
                /** @constant */
                kind: "listing_fee";
                amount: number;
                currency: components["schemas"]["CurrencyCode"];
                period: components["schemas"]["RecurringPeriod"];
                per: components["schemas"]["ChargeBasis"];
            } | null;
            differenceReason?: string;
        } | {
            /** @constant */
            kind: "commission";
            channel: components["schemas"]["CommissionChannel"];
            percentBp: number;
            fixed?: {
                amount: number;
                currency: components["schemas"]["CurrencyCode"];
            };
            effectiveFrom: components["schemas"]["TermDate"];
            effectiveTo?: components["schemas"]["LocalDate"];
            listValue: {
                /** @constant */
                kind: "commission";
                channel: components["schemas"]["CommissionChannel"];
                percentBp: number;
                fixed?: {
                    amount: number;
                    currency: components["schemas"]["CurrencyCode"];
                };
            } | null;
            differenceReason?: string;
        } | {
            /** @constant */
            kind: "delivery_fee_share";
            percentBp: number;
            effectiveFrom: components["schemas"]["TermDate"];
            effectiveTo?: components["schemas"]["LocalDate"];
            listValue: {
                /** @constant */
                kind: "delivery_fee_share";
                percentBp: number;
            } | null;
            differenceReason?: string;
        } | {
            /** @constant */
            kind: "setup_fee";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            label: string;
            dueOn: components["schemas"]["LocalDate"];
            listValue: {
                /** @constant */
                kind: "setup_fee";
                amount: number;
                currency: components["schemas"]["CurrencyCode"];
                label: string;
            } | null;
            differenceReason?: string;
        } | {
            /** @constant */
            kind: "hardware";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            label: string;
            dueOn: components["schemas"]["LocalDate"];
            listValue: {
                /** @constant */
                kind: "hardware";
                amount: number;
                currency: components["schemas"]["CurrencyCode"];
                label: string;
            } | null;
            differenceReason?: string;
        } | {
            /** @constant */
            kind: "service";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            label: string;
            dueOn: components["schemas"]["LocalDate"];
            listValue: {
                /** @constant */
                kind: "service";
                amount: number;
                currency: components["schemas"]["CurrencyCode"];
                label: string;
            } | null;
            differenceReason?: string;
        } | {
            /** @constant */
            kind: "waiver";
            waives: components["schemas"]["WaivedSlot"];
            effectiveFrom: components["schemas"]["TermDate"];
            effectiveTo?: components["schemas"]["LocalDate"];
        };
        TermEndingDraft: {
            termId: components["schemas"]["Id"];
            endsAt: components["schemas"]["TermDate"];
        };
        /** @enum {string} */
        TermKind: "feature" | "limit" | "subscription" | "listing_fee" | "commission" | "delivery_fee_share" | "setup_fee" | "hardware" | "service" | "waiver";
        /** @enum {string} */
        TermState: "in_force" | "future" | "ended" | "one_off";
        TermValues: {
            /** @constant */
            kind: "feature";
            featureKey: components["schemas"]["EntitlementKey"];
        } | {
            /** @constant */
            kind: "limit";
            limitKey: components["schemas"]["EntitlementKey"];
            value: number;
        } | {
            /** @constant */
            kind: "subscription";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            period: components["schemas"]["RecurringPeriod"];
            per: components["schemas"]["ChargeBasis"];
        } | {
            /** @constant */
            kind: "listing_fee";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            period: components["schemas"]["RecurringPeriod"];
            per: components["schemas"]["ChargeBasis"];
        } | {
            /** @constant */
            kind: "commission";
            channel: components["schemas"]["CommissionChannel"];
            percentBp: number;
            fixed?: {
                amount: number;
                currency: components["schemas"]["CurrencyCode"];
            };
        } | {
            /** @constant */
            kind: "delivery_fee_share";
            percentBp: number;
        } | {
            /** @constant */
            kind: "setup_fee";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            label: string;
        } | {
            /** @constant */
            kind: "hardware";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            label: string;
        } | {
            /** @constant */
            kind: "service";
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
            label: string;
        } | {
            /** @constant */
            kind: "waiver";
            waives: components["schemas"]["WaivedSlot"];
        };
        TimeOfDay: string;
        TotpCode: string;
        UpdateAgreementTemplate: {
            nameAr: string;
            nameLatin?: string | null;
            packageId: components["schemas"]["Id"];
            chargeTerms: components["schemas"]["ChargeTermDraft"][];
            updatedAt: components["schemas"]["Instant"];
        };
        UpdateAmendment: {
            changes: components["schemas"]["AmendmentDraftChanges"];
            note: string | null;
            updatedAt: components["schemas"]["Instant"];
        };
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
        UpdatePackage: {
            nameAr: string;
            nameLatin?: string | null;
            features: components["schemas"]["EntitlementKey"][];
            limits: {
                [key: string]: number;
            };
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
        UploadCommands: {
            protocol: number;
            commands: components["schemas"]["UploadedCommand"][];
        };
        UploadCommandsResult: {
            results: components["schemas"]["CommandResult"][];
        };
        UploadedCommand: {
            envelope: components["schemas"]["CommandEnvelope"];
            mirrored: boolean;
        };
        WaivedSlot: {
            /** @enum {string} */
            kind: "subscription" | "listing_fee" | "delivery_fee_share";
        } | {
            /** @constant */
            kind: "commission";
            channel: components["schemas"]["CommissionChannel"];
        };
        Weekday: number;
        WeeklyPeriod: {
            weekday: components["schemas"]["Weekday"];
            opensAt: components["schemas"]["TimeOfDay"];
            closesAt: components["schemas"]["TimeOfDay"];
        };
        /** @enum {string} */
        WhatsAppPauseReason: "manual" | "send_failures";
        WhatsAppQr: {
            state: components["schemas"]["WhatsAppSessionState"];
            qr: string | null;
            expiresAt: components["schemas"]["Instant"] | null;
            linkDeadlineAt: components["schemas"]["Instant"] | null;
        };
        WhatsAppSessionDetail: {
            session: components["schemas"]["PlatformWhatsAppSession"];
            events: components["schemas"]["WhatsAppSessionEvent"][];
        };
        WhatsAppSessionEvent: {
            id: components["schemas"]["Id"];
            type: components["schemas"]["WhatsAppSessionEventType"];
            reason: string | null;
            platformUserName: string | null;
            createdAt: components["schemas"]["Instant"];
        };
        /** @enum {string} */
        WhatsAppSessionEventType: "created" | "linked" | "connected" | "disconnected" | "needs_relink" | "banned" | "link_timeout" | "duplicate_number" | "paused" | "resumed" | "relink_started" | "unlinked" | "alert_sent";
        /** @enum {string} */
        WhatsAppSessionState: "linking" | "connected" | "disconnected" | "needs_relink" | "banned" | "unlinked";
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
    "AuthController.otpDelivery": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                challengeId: components["schemas"]["Id"];
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
                    "application/json": components["schemas"]["OtpDelivery"];
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
    "BranchNetworkController.setRoles": {
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
                "application/json": components["schemas"]["SetHubRoles"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BranchSyncStatus"];
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
    "BranchNetworkController.status": {
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
                    "application/json": components["schemas"]["BranchSyncStatus"];
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
    "CatalogConsoleController.templates": {
        parameters: {
            query?: {
                includeArchived?: "true" | "false";
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
                    "application/json": components["schemas"]["AgreementTemplateList"];
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
    "CatalogConsoleController.createTemplate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgreementTemplateInput"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgreementTemplate"];
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
    "CatalogConsoleController.updateTemplate": {
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
                "application/json": components["schemas"]["UpdateAgreementTemplate"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgreementTemplate"];
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
    "CatalogConsoleController.archiveTemplate": {
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
                "application/json": components["schemas"]["ArchivePreset"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgreementTemplate"];
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
    "AgreementsConsoleController.updateAmendment": {
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
                "application/json": components["schemas"]["UpdateAmendment"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Amendment"];
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
    "AgreementsConsoleController.approve": {
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
                "application/json": components["schemas"]["AmendmentTransition"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Amendment"];
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
    "AgreementsConsoleController.reject": {
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
                "application/json": components["schemas"]["RejectAmendment"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Amendment"];
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
    "AgreementsConsoleController.submit": {
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
                "application/json": components["schemas"]["AmendmentTransition"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Amendment"];
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
    "AgreementsConsoleController.unsubmit": {
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
                "application/json": components["schemas"]["AmendmentTransition"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Amendment"];
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
    "AgreementsConsoleController.withdraw": {
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
                "application/json": components["schemas"]["AmendmentTransition"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Amendment"];
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
    "EntitlementsConsoleController.revokeOverride": {
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
                "application/json": components["schemas"]["RevokeEntitlementOverride"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntitlementOverrideRevocation"];
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
    "CatalogConsoleController.catalog": {
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
                    "application/json": components["schemas"]["FeatureCatalog"];
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
    "MessagingConsoleController.health": {
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
                    "application/json": components["schemas"]["MessagingHealth"];
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
    "CatalogConsoleController.packages": {
        parameters: {
            query?: {
                includeArchived?: "true" | "false";
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
                    "application/json": components["schemas"]["PackageList"];
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
    "CatalogConsoleController.createPackage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PackageInput"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Package"];
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
    "CatalogConsoleController.updatePackage": {
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
                "application/json": components["schemas"]["UpdatePackage"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Package"];
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
    "CatalogConsoleController.archivePackage": {
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
                "application/json": components["schemas"]["ArchivePreset"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Package"];
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
    "AgreementsConsoleController.agreement": {
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
                    "application/json": components["schemas"]["ConsoleAgreement"];
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
    "AgreementsConsoleController.createAmendment": {
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
                "application/json": components["schemas"]["CreateAmendment"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Amendment"];
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
    "EntitlementsConsoleController.exceptions": {
        parameters: {
            query?: {
                before?: components["schemas"]["Id"];
            };
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
                    "application/json": components["schemas"]["EntitlementExceptionPage"];
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
    "EntitlementsConsoleController.createOverride": {
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
                "application/json": components["schemas"]["OverrideInput"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntitlementOverride"];
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
    "EntitlementsConsoleController.get": {
        parameters: {
            query?: {
                at?: components["schemas"]["Instant"];
            };
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
                    "application/json": components["schemas"]["Entitlements"];
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
    "MessagingConsoleController.list": {
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
                    "application/json": components["schemas"]["PlatformWhatsAppSessionList"];
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
    "MessagingConsoleController.create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePlatformWhatsAppSession"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformWhatsAppSession"];
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
    "MessagingConsoleController.get": {
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
                    "application/json": components["schemas"]["WhatsAppSessionDetail"];
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
    "MessagingConsoleController.pause": {
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
                    "application/json": components["schemas"]["PlatformWhatsAppSession"];
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
    "MessagingConsoleController.qr": {
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
                    "application/json": components["schemas"]["WhatsAppQr"];
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
    "MessagingConsoleController.relink": {
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
                    "application/json": components["schemas"]["PlatformWhatsAppSession"];
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
    "MessagingConsoleController.resume": {
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
                    "application/json": components["schemas"]["PlatformWhatsAppSession"];
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
    "MessagingConsoleController.unlink": {
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
    "SyncStaffController.listAttention": {
        parameters: {
            query: {
                page?: number;
                pageSize?: number;
                sort?: "createdAt";
                order?: components["schemas"]["SortOrder"];
                branchId: components["schemas"]["Id"];
                status?: "open" | "closed" | "all";
                kind?: components["schemas"]["AttentionKind"];
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
                    "application/json": components["schemas"]["AttentionPage"];
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
    "SyncStaffController.resolveAttention": {
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
                "application/json": components["schemas"]["ResolveAttention"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttentionItem"];
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
    "SyncDeviceController.certificate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CertificateRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IssuedCertificate"];
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
    "SyncDeviceController.upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UploadCommands"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadCommandsResult"];
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
    "SyncDeviceController.heartbeat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Heartbeat"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HeartbeatAnswer"];
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
    "SyncDeviceController.numberBlocks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NumberBlocksRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NumberBlocks"];
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
    "SyncStaffController.listQuarantine": {
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
                    "application/json": components["schemas"]["QuarantineBatchList"];
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
    "SyncDeviceController.uploadQuarantine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QuarantineUpload"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuarantineUploadResult"];
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
    "SyncStaffController.quarantineDetail": {
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
                    "application/json": components["schemas"]["QuarantineBatchDetail"];
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
    "SyncStaffController.accept": {
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
                    "application/json": components["schemas"]["QuarantineDecisionResult"];
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
    "SyncStaffController.reject": {
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
                "application/json": components["schemas"]["RejectQuarantine"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuarantineDecisionResult"];
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
    "SyncDeviceController.token": {
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
                    "application/json": components["schemas"]["SyncToken"];
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
    "TenantAgreementController.get": {
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
                    "application/json": components["schemas"]["TenantAgreement"];
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
    "TenantEntitlementsController.get": {
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
                    "application/json": components["schemas"]["Entitlements"];
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
