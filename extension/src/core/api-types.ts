// Generated from backend/openapi.json by scripts/gen-api-types.mjs. Do not edit.

export interface paths {
    "/api/agent-config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Agent Config */
        get: operations["agent_config_api_agent_config_get"];
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
        /** Health */
        get: operations["health_api_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/journey/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Journey Summary */
        post: operations["journey_summary_api_journey_summary_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/pages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Page */
        post: operations["create_page_api_pages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/pages/{page_id}/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Scan */
        get: operations["get_scan_api_pages__page_id__scan_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tools/ask-page": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ask Page Endpoint */
        post: operations["ask_page_endpoint_api_tools_ask_page_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tools/explain-field": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Explain Field Endpoint */
        post: operations["explain_field_endpoint_api_tools_explain_field_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tools/loan-cost": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Loan Cost Endpoint */
        post: operations["loan_cost_endpoint_api_tools_loan_cost_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tools/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Scan Endpoint */
        post: operations["scan_endpoint_api_tools_scan_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tools/site-trust": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Site Trust Endpoint */
        post: operations["site_trust_endpoint_api_tools_site_trust_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tools/summarize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Summarize Endpoint */
        post: operations["summarize_endpoint_api_tools_summarize_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tools/walkthrough": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Walkthrough Endpoint */
        post: operations["walkthrough_endpoint_api_tools_walkthrough_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tools/web-lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Web Lookup Endpoint */
        post: operations["web_lookup_endpoint_api_tools_web_lookup_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/voice-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Voice Token */
        get: operations["get_voice_token_api_voice_token_get"];
        put?: never;
        post?: never;
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
        /** AgentConfigResponse */
        AgentConfigResponse: {
            /**
             * Contract Version
             * @default 1
             * @constant
             */
            contract_version: 1;
            /** Max Session Seconds */
            max_session_seconds: number;
            session: components["schemas"]["AgentSession"];
            /** Warn Before End Seconds */
            warn_before_end_seconds: number;
        };
        /**
         * AgentSession
         * @description The body of AssemblyAI's session.update event, sent by the client unchanged.
         */
        AgentSession: {
            /**
             * Greeting
             * @description Left out when greet=false.
             */
            greeting?: string | null;
            input: components["schemas"]["SessionInput"];
            output: components["schemas"]["SessionOutput"];
            /** System Prompt */
            system_prompt: string;
            /** Tools */
            tools: {
                [key: string]: unknown;
            }[];
        };
        /** AnswerCard */
        AnswerCard: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "answer";
            /** Lead */
            lead: string;
            quote: components["schemas"]["AnswerQuote"] | null;
            /** Risks */
            risks: components["schemas"]["RiskFlag"][];
            /**
             * Source
             * @enum {string}
             */
            source: "page" | "web" | "calculated" | "not_found";
            /** Topic */
            topic: string;
        };
        /** AnswerQuote */
        AnswerQuote: {
            /** Page Title */
            page_title: string | null;
            /** Page Url */
            page_url: string | null;
            /** Section Heading */
            section_heading: string | null;
            /** Section Id */
            section_id: string;
            /** Text */
            text: string;
        };
        /** AskPageRequest */
        AskPageRequest: {
            /** Earlier Page Ids */
            earlier_page_ids?: string[];
            /** Page Id */
            page_id: string;
            pointer?: components["schemas"]["PointerHint"] | null;
            /** Question */
            question: string;
        };
        /** AudioFormat */
        AudioFormat: {
            /**
             * Encoding
             * @default audio/pcm
             * @constant
             */
            encoding: "audio/pcm";
        };
        /** Button */
        Button: {
            /** Disabled */
            disabled: boolean;
            /** Id */
            id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "button" | "submit" | "link";
            /** Text */
            text: string;
        };
        /** Choice */
        Choice: {
            /** Amount Inr */
            amount_inr: number | null;
            /** Checked */
            checked: boolean;
            /** First Seen Revision */
            first_seen_revision: number;
            /** Group */
            group: string | null;
            /** Id */
            id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "checkbox" | "radio";
            /** Label */
            label: string;
            /** Prechecked */
            prechecked: boolean;
        };
        /** ClientFlag */
        ClientFlag: {
            /** Amount Inr */
            amount_inr: number | null;
            /**
             * Category
             * @enum {string}
             */
            category: "costs_money" | "auto_debit" | "shares_data" | "hard_to_cancel" | "auto_renews" | "limits_rights" | "worth_knowing";
            /** Detail */
            detail: string;
            /** Element Ids */
            element_ids: string[];
            /** Params */
            params: {
                [key: string]: number | string;
            };
            /**
             * Rule
             * @enum {string}
             */
            rule: "prechecked_paid_addon" | "prechecked_marketing_consent" | "late_price" | "trial_to_paid" | "flat_rate_offer" | "countdown_timer" | "hidden_cookie_reject";
            /**
             * Severity
             * @enum {string}
             */
            severity: "high" | "medium" | "info";
        };
        /** CookieBanner */
        CookieBanner: {
            /** Accept Button Id */
            accept_button_id: string | null;
            /** Id */
            id: string;
            /** Manage Button Id */
            manage_button_id: string | null;
            /** Reject Button Id */
            reject_button_id: string | null;
            /** Reject Visible */
            reject_visible: boolean;
        };
        /** CreatePageRequest */
        CreatePageRequest: {
            snapshot: components["schemas"]["PageSnapshot"];
        };
        /** CreatePageResponse */
        CreatePageResponse: {
            /**
             * Contract Version
             * @default 1
             * @constant
             */
            contract_version: 1;
            /** Page Id */
            page_id: string;
            /**
             * Page Type
             * @enum {string}
             */
            page_type: "terms" | "privacy" | "checkout" | "form" | "offer" | "article" | "other";
            scan: components["schemas"]["ScanBrief"];
            /** Site Signals */
            site_signals: string[];
            /** Summary For Agent */
            summary_for_agent: string;
        };
        /**
         * ErrorBody
         * @description retry_after_seconds is left out when there's no wait to suggest.
         */
        ErrorBody: {
            /** Agent Message */
            agent_message: string;
            /** Code */
            code: string;
            /** Message */
            message: string;
            /** Retry After Seconds */
            retry_after_seconds?: number | null;
        };
        /** ErrorEnvelope */
        ErrorEnvelope: {
            /**
             * Contract Version
             * @default 1
             * @constant
             */
            contract_version: 1;
            error: components["schemas"]["ErrorBody"];
        };
        /** ExplainFieldRequest */
        ExplainFieldRequest: {
            /** Field Id */
            field_id?: string | null;
            /** Field Label */
            field_label?: string | null;
            /** Page Id */
            page_id: string;
            pointer?: components["schemas"]["PointerHint"] | null;
        };
        /** FieldCard */
        FieldCard: {
            /** Example */
            example: string | null;
            /** Field Id */
            field_id: string | null;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "field";
            /** Lead */
            lead: string;
            /** Rows */
            rows: components["schemas"]["FieldRow"][];
            /**
             * Source
             * @enum {string}
             */
            source: "page" | "web" | "calculated" | "not_found";
            /** Topic */
            topic: string;
        };
        /** FieldRow */
        FieldRow: {
            /**
             * Label
             * @enum {string}
             */
            label: "What it is" | "Where to find it" | "Format" | "Common mistake";
            /** Value */
            value: string;
        };
        /**
         * FormStep
         * @description One step of a form walkthrough: a part of the form, or one field.
         */
        FormStep: {
            /** Element Ids */
            element_ids: string[];
            /** Heading */
            heading?: string | null;
            /** Key */
            key: string;
        };
        /** HealthResponse */
        HealthResponse: {
            /**
             * Contract Version
             * @default 1
             * @constant
             */
            contract_version: 1;
            service: components["schemas"]["ServiceState"];
            /**
             * Status
             * @default ok
             * @constant
             */
            status: "ok";
            /** Version */
            version: string;
        };
        /**
         * JourneySummaryRequest
         * @description The trail's fact lines, oldest first, and the summary so far.
         */
        JourneySummaryRequest: {
            /** Facts */
            facts: string[];
            /** Previous Summary */
            previous_summary?: string | null;
        };
        /** JourneySummaryResponse */
        JourneySummaryResponse: {
            /**
             * Contract Version
             * @default 1
             * @constant
             */
            contract_version: 1;
            /** Summary */
            summary: string;
        };
        /** LegalLink */
        LegalLink: {
            /** Href */
            href: string;
            /** Id */
            id: string;
            /** Text */
            text: string;
        };
        /** LoanCostRequest */
        LoanCostRequest: {
            /**
             * Fees Deducted Upfront
             * @default true
             */
            fees_deducted_upfront: boolean;
            /** Gst Percent On Fee */
            gst_percent_on_fee?: number | null;
            /** Page Id */
            page_id?: string | null;
            /** Principal Inr */
            principal_inr?: number | null;
            /** Processing Fee Inr */
            processing_fee_inr?: number | null;
            /** Processing Fee Percent */
            processing_fee_percent?: number | null;
            /** Rate Basis */
            rate_basis?: ("flat_monthly" | "flat_annual" | "reducing_annual") | null;
            /** Rate Percent */
            rate_percent?: number | null;
            /** Tenure Months */
            tenure_months?: number | null;
        };
        /** Nudge */
        Nudge: {
            /** Highlight Ids */
            highlight_ids: string[];
            /** Risk Ids */
            risk_ids: string[];
            /** Risk Keys */
            risk_keys: string[];
            /** Say */
            say: string;
        };
        /** PageField */
        PageField: {
            /** Filled */
            filled: boolean;
            /** Help Text */
            help_text: string | null;
            /** Id */
            id: string;
            /** Label */
            label: string;
            /** Options */
            options: string[];
            /** Placeholder */
            placeholder: string | null;
            /** Required */
            required: boolean;
            /** Section */
            section: string | null;
            /** Sensitive */
            sensitive: boolean;
            /**
             * Type
             * @enum {string}
             */
            type: "text" | "email" | "tel" | "number" | "date" | "select" | "textarea" | "password" | "other";
        };
        /** PageSnapshot */
        PageSnapshot: {
            /** Buttons */
            buttons: components["schemas"]["Button"][];
            /** Captured At */
            captured_at: string;
            /** Checkboxes */
            checkboxes: components["schemas"]["Choice"][];
            /** Client Flags */
            client_flags: components["schemas"]["ClientFlag"][];
            /**
             * Contract Version
             * @constant
             */
            contract_version: 1;
            cookie_banner: components["schemas"]["CookieBanner"] | null;
            /** Fields */
            fields: components["schemas"]["PageField"][];
            /** Lang */
            lang: string | null;
            /** Legal Links */
            legal_links: components["schemas"]["LegalLink"][];
            /**
             * Page Type Hint
             * @enum {string}
             */
            page_type_hint: "terms" | "privacy" | "checkout" | "form" | "offer" | "article" | "other";
            /** Prices */
            prices: components["schemas"]["Price"][];
            /** Revision */
            revision: number;
            /** Sections */
            sections: components["schemas"]["Section"][];
            /** Title */
            title: string;
            /** Truncated */
            truncated: boolean;
            /** Url */
            url: string;
        };
        /**
         * PointerHint
         * @description What the user last pointed at or focused on the page: element IDs only.
         */
        PointerHint: {
            /** Field Id */
            field_id?: string | null;
            /** Price Id */
            price_id?: string | null;
            /** Section Id */
            section_id?: string | null;
        };
        /** Price */
        Price: {
            /** Amount Inr */
            amount_inr: number | null;
            /** Amount Text */
            amount_text: string;
            /** First Seen Revision */
            first_seen_revision: number;
            /** Id */
            id: string;
            /** Label */
            label: string | null;
        };
        /** RiskFlag */
        RiskFlag: {
            /** Amount Inr */
            amount_inr: number | null;
            /**
             * Category
             * @enum {string}
             */
            category: "costs_money" | "auto_debit" | "shares_data" | "hard_to_cancel" | "auto_renews" | "limits_rights" | "worth_knowing";
            /** Detail */
            detail: string;
            /** Element Ids */
            element_ids: string[];
            /** Id */
            id: string;
            /** Key */
            key: string;
            /**
             * Origin
             * @enum {string}
             */
            origin: "client_rule" | "page_text";
            /** Quote */
            quote: string | null;
            /** Section Id */
            section_id: string | null;
            /**
             * Severity
             * @enum {string}
             */
            severity: "high" | "medium" | "info";
            /** Title */
            title: string;
        };
        /** RiskListCard */
        RiskListCard: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "risk_list";
            /** Lead */
            lead: string;
            /** Risks */
            risks: components["schemas"]["RiskFlag"][];
            /**
             * Source
             * @enum {string}
             */
            source: "page" | "web" | "calculated" | "not_found";
            /** Topic */
            topic: string;
        };
        /** ScanBrief */
        ScanBrief: {
            /** Kind */
            kind: ("terms" | "privacy" | "checkout" | "offer" | "general") | null;
            /**
             * Status
             * @enum {string}
             */
            status: "pending" | "ready" | "failed" | "none";
        };
        /** ScanCounts */
        ScanCounts: {
            /** High */
            high: number;
            /** Info */
            info: number;
            /** Medium */
            medium: number;
        };
        /** ScanRequest */
        ScanRequest: {
            /** Kind */
            kind?: ("terms" | "privacy" | "checkout" | "offer" | "general") | null;
            /** Page Id */
            page_id: string;
        };
        /** ScanResult */
        ScanResult: {
            /**
             * Contract Version
             * @default 1
             * @constant
             */
            contract_version: 1;
            counts: components["schemas"]["ScanCounts"];
            /** Kind */
            kind: ("terms" | "privacy" | "checkout" | "offer" | "general") | null;
            nudge: components["schemas"]["Nudge"] | null;
            /** Page Id */
            page_id: string;
            /** Risks */
            risks: components["schemas"]["RiskFlag"][];
            /**
             * Status
             * @enum {string}
             */
            status: "pending" | "ready" | "failed" | "none";
        };
        /** Section */
        Section: {
            /** Heading */
            heading: string | null;
            /** Id */
            id: string;
            /** Level */
            level: number | null;
            /** Text */
            text: string;
        };
        /** ServiceState */
        ServiceState: {
            /** Open */
            open: boolean;
            /** Reason */
            reason: ("daily_cap" | "total_cap" | "paused") | null;
        };
        /** SessionInput */
        SessionInput: {
            format: components["schemas"]["AudioFormat"];
            /** Keyterms */
            keyterms: string[];
        };
        /** SessionOutput */
        SessionOutput: {
            format: components["schemas"]["AudioFormat"];
            /** Voice */
            voice: string;
        };
        /** SiteTrustRequest */
        SiteTrustRequest: {
            /** Url */
            url: string;
        };
        /** Source */
        Source: {
            /** Domain */
            domain: string;
            /** Title */
            title: string;
            /** Url */
            url: string;
        };
        /** SummarizeRequest */
        SummarizeRequest: {
            /** Focus */
            focus?: string | null;
            /** Page Id */
            page_id: string;
            /**
             * Style
             * @default quick
             * @enum {string}
             */
            style: "quick" | "detailed";
        };
        /** SummaryCard */
        SummaryCard: {
            /** Bullets */
            bullets: string[];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "summary";
            /** Lead */
            lead: string;
            /**
             * Source
             * @enum {string}
             */
            source: "page" | "web" | "calculated" | "not_found";
            /** Topic */
            topic: string;
        };
        /** ToolResult */
        ToolResult: {
            /** Agent Notes */
            agent_notes: string;
            /** Card */
            card: (components["schemas"]["AnswerCard"] | components["schemas"]["FieldCard"] | components["schemas"]["RiskListCard"] | components["schemas"]["SummaryCard"] | components["schemas"]["WebAnswerCard"] | components["schemas"]["TrueCostCard"] | components["schemas"]["TrustCard"]) | null;
            /**
             * Contract Version
             * @default 1
             * @constant
             */
            contract_version: 1;
            /** Highlight Ids */
            highlight_ids: string[];
            /** Not Found */
            not_found: boolean;
            /** Quote Text */
            quote_text: string | null;
            /** Say */
            say: string;
            /** Sources */
            sources: components["schemas"]["Source"][];
        };
        /** TrueCostCard */
        TrueCostCard: {
            /** Advertised */
            advertised: string;
            /** Apr Percent */
            apr_percent: number;
            /** Effective Annual Percent */
            effective_annual_percent: number;
            /** Emi Inr */
            emi_inr: number;
            /** Explanation */
            explanation: string[];
            /** Extra Over Price Inr */
            extra_over_price_inr: number;
            /** Fees Upfront Inr */
            fees_upfront_inr: number;
            /** Figure Text */
            figure_text: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "true_cost";
            /** Lead */
            lead: string;
            /**
             * Source
             * @enum {string}
             */
            source: "page" | "web" | "calculated" | "not_found";
            /** Tenure Months */
            tenure_months: number;
            /** Topic */
            topic: string;
            /** Total Paid Inr */
            total_paid_inr: number;
        };
        /** TrustCard */
        TrustCard: {
            /** Checks Line */
            checks_line: string;
            /** Domain */
            domain: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "trust";
            /** Lead */
            lead: string;
            /** Reasons */
            reasons: components["schemas"]["TrustReason"][];
            /**
             * Source
             * @enum {string}
             */
            source: "page" | "web" | "calculated" | "not_found";
            /** Topic */
            topic: string;
            /**
             * Verdict
             * @enum {string}
             */
            verdict: "looks_ok" | "be_careful" | "likely_unsafe";
        };
        /** TrustReason */
        TrustReason: {
            /**
             * Level
             * @enum {string}
             */
            level: "good" | "warn" | "bad";
            /** Text */
            text: string;
        };
        /** VoiceTokenResponse */
        VoiceTokenResponse: {
            /**
             * Contract Version
             * @default 1
             * @constant
             */
            contract_version: 1;
            /** Expires In Seconds */
            expires_in_seconds: number;
            /** Max Session Seconds */
            max_session_seconds: number;
            /** Token */
            token: string;
        };
        /**
         * WalkthroughRequest
         * @description Up to 5 page sections, or up to 5 form steps, in page order.
         */
        WalkthroughRequest: {
            /** Form Steps */
            form_steps?: components["schemas"]["FormStep"][];
            /** Page Id */
            page_id: string;
            /** Section Ids */
            section_ids?: string[];
        };
        /** WalkthroughResponse */
        WalkthroughResponse: {
            /**
             * Contract Version
             * @default 1
             * @constant
             */
            contract_version: 1;
            /** Steps */
            steps: components["schemas"]["WalkthroughStep"][];
        };
        /** WalkthroughStep */
        WalkthroughStep: {
            /** Heading */
            heading: string | null;
            /** Key */
            key: string;
            /** Risk Ids */
            risk_ids: string[];
            /** Say */
            say: string;
        };
        /** WebAnswerCard */
        WebAnswerCard: {
            /** Bullets */
            bullets: string[];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "web_answer";
            /** Lead */
            lead: string;
            /**
             * Source
             * @enum {string}
             */
            source: "page" | "web" | "calculated" | "not_found";
            /** Topic */
            topic: string;
        };
        /** WebLookupRequest */
        WebLookupRequest: {
            /** Page Id */
            page_id?: string | null;
            /** Query */
            query: string;
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
    agent_config_api_agent_config_get: {
        parameters: {
            query?: {
                greet?: boolean;
                voice?: "female" | "male";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentConfigResponse"];
                };
            };
        };
    };
    health_api_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    journey_summary_api_journey_summary_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JourneySummaryRequest"];
            };
        };
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JourneySummaryResponse"];
                };
            };
        };
    };
    create_page_api_pages_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePageRequest"];
            };
        };
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatePageResponse"];
                };
            };
        };
    };
    get_scan_api_pages__page_id__scan_get: {
        parameters: {
            query?: {
                exclude_keys?: string | null;
            };
            header?: never;
            path: {
                page_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanResult"];
                };
            };
        };
    };
    ask_page_endpoint_api_tools_ask_page_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AskPageRequest"];
            };
        };
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolResult"];
                };
            };
        };
    };
    explain_field_endpoint_api_tools_explain_field_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExplainFieldRequest"];
            };
        };
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolResult"];
                };
            };
        };
    };
    loan_cost_endpoint_api_tools_loan_cost_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoanCostRequest"];
            };
        };
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolResult"];
                };
            };
        };
    };
    scan_endpoint_api_tools_scan_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScanRequest"];
            };
        };
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolResult"];
                };
            };
        };
    };
    site_trust_endpoint_api_tools_site_trust_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SiteTrustRequest"];
            };
        };
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolResult"];
                };
            };
        };
    };
    summarize_endpoint_api_tools_summarize_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SummarizeRequest"];
            };
        };
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolResult"];
                };
            };
        };
    };
    walkthrough_endpoint_api_tools_walkthrough_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WalkthroughRequest"];
            };
        };
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WalkthroughResponse"];
                };
            };
        };
    };
    web_lookup_endpoint_api_tools_web_lookup_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WebLookupRequest"];
            };
        };
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolResult"];
                };
            };
        };
    };
    get_voice_token_api_voice_token_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Error envelope */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Error envelope */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceTokenResponse"];
                };
            };
        };
    };
}
