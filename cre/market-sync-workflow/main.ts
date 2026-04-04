import {
    CronCapability,
    HTTPClient,
    handler,
    ok,
    consensusIdenticalAggregation,
    type Runtime,
    type NodeRuntime,
    Runner,
    HTTPSendRequester,
} from "@chainlink/cre-sdk";
import { z } from "zod";

/* Config */
const configSchema = z.object({
    schedule: z.string(),
    gammaApiUrl: z.string(),
    backendSyncUrl: z.string(),
    marketLimit: z.number().int().positive(),
});

type Config = z.infer<typeof configSchema>;

/* Types */
type GammaMarket = {
    conditionId: string;
    question: string;
    slug: string;
    active: boolean;
    closed: boolean;
    outcomes: string;
    outcomePrices: string;
    clobTokenIds: string;
    endDateIso: string;
};

type GammaEvent = {
    id: string;
    title: string;
    slug: string;
    markets: GammaMarket[];
};

type SyncMarket = {
    conditionId: string;
    question: string;
    slug: string;
    endDate: string;
    tokens: { tokenId: string; outcome: string; price: number }[];
};

type SyncPayload = {
    syncedAt: number;
    marketCount: number;
    markets: SyncMarket[];
};

type PostResult = {
    statusCode: number;
};

const fetchMarkets = (sendRequester: HTTPSendRequester, config: Config): string => {
    const url =
        `${config.gammaApiUrl}/markets` +
        `?active=true&closed=false` +
        `&limit=${config.marketLimit}`;

    const resp = sendRequester.sendRequest({ url, method: "GET" as const }).result();

    if (!ok(resp)) {
        throw new Error(`Gamma API returned ${resp.statusCode}`);
    }

    const rawMarkets = JSON.parse(new TextDecoder().decode(resp.body)) as GammaMarket[];

    const markets: SyncMarket[] = [];

    for (const m of rawMarkets) {
        if (!m.active || m.closed) continue;
        if (!m.conditionId) continue;

        const outcomes: string[] = JSON.parse(m.outcomes || "[]");
        const prices: string[] = JSON.parse(m.outcomePrices || "[]");
        const tokenIds: string[] = JSON.parse(m.clobTokenIds || "[]");

        const tokens = outcomes.map((outcome, i) => ({
            tokenId: tokenIds[i] ?? "",
            outcome,
            price: parseFloat(prices[i] ?? "0"),
        }));

        markets.push({
            conditionId: m.conditionId,
            question: m.question ?? "",
            slug: m.slug ?? "",
            endDate: m.endDateIso ?? "",
            tokens,
        });
    }

    return JSON.stringify({
        syncedAt: Math.floor(Date.now() / 1000),
        marketCount: markets.length,
        markets,
    });
};

const postToBackend = (
    nodeRuntime: NodeRuntime<Config>,
    payloadJson: string,
    accessToken: string,
): PostResult => {
    const httpClient = new HTTPClient();

    const bodyBytes = new TextEncoder().encode(payloadJson);
    const body = Buffer.from(bodyBytes).toString("base64");

    const resp = httpClient
        .sendRequest(nodeRuntime, {
            url: nodeRuntime.config.backendSyncUrl,
            method: "POST" as const,
            body,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
            },
            cacheSettings: {
                store: true,
                maxAge: "60s",
            },
        })
        .result();

    if (!ok(resp)) {
        throw new Error(`Backend sync failed: ${resp.statusCode}`);
    }

    return { statusCode: resp.statusCode };
};

// Cron trigger
const onCronTrigger = (runtime: Runtime<Config>): string => {
    // Fetch secret before any capability calls
    const accessToken = runtime.getSecret({ id: "BACKEND_ACCESS_TOKEN" }).result().value;

    const httpClient = new HTTPClient();

    // Fetch markets
    const payloadJson = httpClient
        .sendRequest(runtime, fetchMarkets, consensusIdenticalAggregation<string>())(runtime.config)
        .result();

    const payload = JSON.parse(payloadJson) as SyncPayload;
    runtime.log(`Fetched ${payload.marketCount} active markets from Polymarket`);

    // POST to backend
    const result = runtime
        .runInNodeMode(
            postToBackend,
            consensusIdenticalAggregation<PostResult>(),
        )(payloadJson, accessToken)
        .result();

    runtime.log(`Backend sync responded with status ${result.statusCode}`);

    return `Synced ${payload.marketCount} markets`;
};

// init workflow
const initWorkflow = (config: Config) => {
    const cron = new CronCapability();

    return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
    const runner = await Runner.newRunner<Config>({ configSchema });
    await runner.run(initWorkflow);
}

main();
