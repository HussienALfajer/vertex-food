// Generated from apps/api/openapi.json by test/api-schema.test.ts; never edit by hand.
export interface paths {
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
        ArchiveBranch: {
            note?: string;
        };
        /** @enum {string} */
        AuditAction: "tenant.created" | "tenant.profile_updated" | "tenant.slug_changed" | "tenant.status_scheduled" | "tenant.status_changed" | "tenant.status_schedule_cancelled" | "tenant.status_rescheduled" | "tenant.onboarding_completed" | "tenant_logo.replaced" | "tenant_logo.archived" | "tenant_cover.replaced" | "tenant_cover.archived" | "branch.created" | "branch.updated" | "branch.archived" | "branch_hours.replaced" | "branch_hour_exception.created" | "branch_hour_exception.updated" | "branch_hour_exception.archived" | "branch_charges.replaced" | "governorate.created" | "city.created";
        /** @enum {string} */
        AuditActorKind: "staff" | "customer" | "driver" | "platform" | "system";
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
        BranchChargeList: components["schemas"]["BranchCharge"][];
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
        BusinessDayEnd: string;
        CancelScheduledTenantStatus: {
            /** @constant */
            cancelScheduled: true;
            note?: string;
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
        /** @enum {string} */
        ConsolePermission: "console.tenants.manage" | "console.tenants.status";
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
        CreateTenant: {
            nameAr: string;
            nameLatin?: string;
            slug: string;
            defaultCurrency: components["schemas"]["CurrencyCode"];
            branches: components["schemas"]["CreateBranch"][];
            note?: string;
        };
        /**
         * @description ISO 4217 code; amounts are integers in minor units of 10^-exponent.
         * @enum {string}
         */
        CurrencyCode: "USD" | "TRY" | "SYP";
        /** @enum {string} */
        ErrorCode: "VALIDATION_FAILED" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_ENTITLED" | "TENANT_SUSPENDED" | "TENANT_CLOSED" | "NOT_FOUND" | "CONFLICT" | "INVALID_STATUS_TRANSITION" | "LAST_ACTIVE_BRANCH" | "SLUG_TAKEN" | "BRANCH_CURRENCY_LOCKED" | "CURRENCY_MISMATCH" | "INVALID_AMOUNT" | "ONBOARDING_INCOMPLETE" | "FILE_REJECTED" | "MAP_LINK_UNRECOGNIZED" | "SLUG_RESERVED" | "INVALID_HOURS" | "RATE_LIMITED" | "INTERNAL_ERROR" | "SERVICE_UNAVAILABLE";
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
        /** Format: date-time */
        Instant: string;
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
        Liveness: {
            /** @constant */
            status: "ok";
        };
        /** Format: date */
        LocalDate: string;
        MissingOnboardingItem: {
            item: components["schemas"]["OnboardingItem"];
            branchId: components["schemas"]["Id"] | null;
        };
        Money: {
            amount: number;
            currency: components["schemas"]["CurrencyCode"];
        };
        NoContent: null;
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
        /** @enum {string} */
        OrderType: "dine_in" | "takeaway" | "delivery" | "pickup";
        PhoneNumber: string;
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
        ScheduledStatusChange: {
            status: components["schemas"]["ScheduledTenantStatus"];
            reason: components["schemas"]["TenantStatusReason"];
            at: components["schemas"]["Instant"];
        };
        /** @enum {string} */
        ScheduledTenantStatus: "suspended" | "closed";
        SetTenantSlug: {
            slug: string;
        };
        Slug: string;
        /** @enum {string} */
        SortOrder: "asc" | "desc";
        /** @enum {string} */
        StaffPermission: "tenant.view" | "tenant.profile.edit" | "branch.settings.edit" | "branch.hours.edit";
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
        UpdateHourException: {
            closed: boolean;
            periods: components["schemas"]["OpeningPeriod"][];
            note: string | null;
            updatedAt: components["schemas"]["Instant"];
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
                    "application/json": components["schemas"]["BranchChargeList"];
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
