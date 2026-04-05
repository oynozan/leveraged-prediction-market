import {
    HTTPCapability,
    HTTPClient,
    EVMClient,
    handler,
    ok,
    getNetwork,
    hexToBase64,
    bytesToHex,
    encodeCallMsg,
    TxStatus,
    consensusIdenticalAggregation,
    LAST_FINALIZED_BLOCK_NUMBER,
    type Runtime,
    type NodeRuntime,
    type HTTPPayload,
    Runner,
} from "@chainlink/cre-sdk";
import {
    encodeFunctionData,
    decodeFunctionResult,
    encodeAbiParameters,
    zeroAddress,
} from "viem";
import { z } from "zod";
import {
    vaultAbi,
    RecoveryReportWrapperParams,
    MarginRecoveryInnerParams,
    LPRepayInnerParams,
    ACTION_RELEASE_MARGIN,
    ACTION_REPAY_LP,
} from "../contracts/abi";

const configSchema = z.object({
    chainSelectorName: z.string(),
    vaultAddress: z.string(),
    recoveryReceiverAddress: z.string(),
    backendPositionsUrl: z.string(),
    backendStaleBorrowsUrl: z.string(),
    gasLimit: z.string(),
});

type Config = z.infer<typeof configSchema>;

type WalletSummary = {
    wallet: string;
    totalLockedMargin: number;
};

type PositionsResponse = {
    wallets: WalletSummary[];
    totalPositions: number;
};

type RecoveryAction = {
    wallet: string;
    onChainLocked: bigint;
    expectedLocked: bigint;
    excess: bigint;
};

type StaleBorrow = {
    conditionId: string;
    totalBorrowed: number;
    positionIds: string[];
};

type StaleBorrowsResponse = {
    borrows: StaleBorrow[];
    totalPositions: number;
};

const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

function fetchPositions(
    nodeRuntime: NodeRuntime<Config>,
    accessToken: string,
): PositionsResponse {
    const httpClient = new HTTPClient();

    const resp = httpClient
        .sendRequest(nodeRuntime, {
            url: nodeRuntime.config.backendPositionsUrl,
            method: "GET" as const,
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        })
        .result();

    if (!ok(resp)) {
        throw new Error(`Backend positions returned ${resp.statusCode}`);
    }

    return JSON.parse(new TextDecoder().decode(resp.body)) as PositionsResponse;
}

function fetchStaleBorrows(
    nodeRuntime: NodeRuntime<Config>,
    accessToken: string,
): StaleBorrowsResponse {
    const httpClient = new HTTPClient();

    const resp = httpClient
        .sendRequest(nodeRuntime, {
            url: nodeRuntime.config.backendStaleBorrowsUrl,
            method: "GET" as const,
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        })
        .result();

    if (!ok(resp)) {
        throw new Error(`Backend stale-borrows returned ${resp.statusCode}`);
    }

    return JSON.parse(new TextDecoder().decode(resp.body)) as StaleBorrowsResponse;
}

function readOnChainMargin(
    evmClient: EVMClient,
    runtime: Runtime<Config>,
    wallet: `0x${string}`,
): { total: bigint; locked: bigint; available: bigint } {
    const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "getMargin",
        args: [wallet],
    });

    const raw = evmClient
        .callContract(runtime, {
            call: encodeCallMsg({
                from: zeroAddress,
                to: runtime.config.vaultAddress as `0x${string}`,
                data,
            }),
            blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result();

    const [total, locked, available] = decodeFunctionResult({
        abi: vaultAbi,
        functionName: "getMargin",
        data: bytesToHex(raw.data) as `0x${string}`,
    }) as [bigint, bigint, bigint];

    return { total, locked, available };
}

function encodeRecoveryReport(action: number, innerData: `0x${string}`): `0x${string}` {
    return encodeAbiParameters(RecoveryReportWrapperParams, [action, innerData]);
}

function submitReport(
    runtime: Runtime<Config>,
    evmClient: EVMClient,
    reportData: `0x${string}`,
    label: string,
): boolean {
    const reportResponse = runtime
        .report({
            encodedPayload: hexToBase64(reportData),
            encoderName: "evm",
            signingAlgo: "ecdsa",
            hashingAlgo: "keccak256",
        })
        .result();

    const writeResult = evmClient
        .writeReport(runtime, {
            receiver: runtime.config.recoveryReceiverAddress,
            report: reportResponse,
            gasConfig: { gasLimit: runtime.config.gasLimit },
        })
        .result();

    if (writeResult.txStatus === TxStatus.SUCCESS) {
        const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
        runtime.log(`${label} tx: ${txHash}`);
        return true;
    }

    runtime.log(`${label} tx FAILED: status=${writeResult.txStatus}`);
    return false;
}

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
    const config = runtime.config;

    runtime.log("Recovery workflow triggered");

    const accessToken = runtime.getSecret({ id: "BACKEND_ACCESS_TOKEN" }).result().value;

    const network = getNetwork({
        chainFamily: "evm",
        chainSelectorName: config.chainSelectorName,
    });
    if (!network) throw new Error(`Network not found: ${config.chainSelectorName}`);

    const evmClient = new EVMClient(network.chainSelector.selector);

    let totalMarginRecovered = 0n;
    let walletsRecovered = 0;
    let totalLPRepaid = 0n;
    let lpRepaidCount = 0;

    /* ── Phase 1: Margin recovery (excess locked margin) ── */

    const positions = runtime
        .runInNodeMode(fetchPositions, consensusIdenticalAggregation<PositionsResponse>())(
            accessToken,
        )
        .result();

    runtime.log(`Fetched ${positions.totalPositions} open positions across ${positions.wallets.length} wallet(s)`);

    if (positions.wallets.length > 0) {
        const actions: RecoveryAction[] = [];

        for (const ws of positions.wallets) {
            const wallet = ws.wallet as `0x${string}`;
            const margin = readOnChainMargin(evmClient, runtime, wallet);
            const expectedLocked = BigInt(Math.round(ws.totalLockedMargin * USDC_SCALE));

            runtime.log(
                `Wallet ${ws.wallet}: on-chain locked=${margin.locked}, expected=${expectedLocked}`,
            );

            if (margin.locked > expectedLocked) {
                const excess = margin.locked - expectedLocked;
                actions.push({
                    wallet: ws.wallet,
                    onChainLocked: margin.locked,
                    expectedLocked,
                    excess,
                });
            }
        }

        for (const action of actions) {
            runtime.log(
                `Recovering margin: ${action.excess} (${Number(action.excess) / USDC_SCALE} USDC) for ${action.wallet}`,
            );

            const innerData = encodeAbiParameters(MarginRecoveryInnerParams, [
                action.wallet as `0x${string}`,
                action.excess,
            ]);
            const reportData = encodeRecoveryReport(ACTION_RELEASE_MARGIN, innerData);

            if (submitReport(runtime, evmClient, reportData, `Margin recovery for ${action.wallet}`)) {
                totalMarginRecovered += action.excess;
                walletsRecovered++;
            }
        }
    }

    /* ── Phase 2: LP repayment (stale borrows from closed positions) ── */

    const staleBorrows = runtime
        .runInNodeMode(fetchStaleBorrows, consensusIdenticalAggregation<StaleBorrowsResponse>())(
            accessToken,
        )
        .result();

    runtime.log(`Fetched ${staleBorrows.totalPositions} stale borrow position(s) across ${staleBorrows.borrows.length} condition(s)`);

    for (const borrow of staleBorrows.borrows) {
        const amountMicro = BigInt(Math.round(borrow.totalBorrowed * USDC_SCALE));
        if (amountMicro <= 0n) continue;

        runtime.log(
            `Repaying LP: ${amountMicro} (${Number(amountMicro) / USDC_SCALE} USDC) for conditionId=${borrow.conditionId}`,
        );

        const innerData = encodeAbiParameters(LPRepayInnerParams, [
            borrow.conditionId as `0x${string}`,
            amountMicro,
        ]);
        const reportData = encodeRecoveryReport(ACTION_REPAY_LP, innerData);

        if (submitReport(runtime, evmClient, reportData, `LP repay for ${borrow.conditionId}`)) {
            totalLPRepaid += amountMicro;
            lpRepaidCount++;
        }
    }

    /* ── Summary ── */

    const parts: string[] = [];

    if (walletsRecovered > 0) {
        parts.push(`Margin: $${(Number(totalMarginRecovered) / USDC_SCALE).toFixed(2)} recovered for ${walletsRecovered} wallet(s)`);
    }
    if (lpRepaidCount > 0) {
        parts.push(`LP: $${(Number(totalLPRepaid) / USDC_SCALE).toFixed(2)} repaid for ${lpRepaidCount} condition(s)`);
    }

    if (parts.length === 0) {
        runtime.log("Nothing to recover.");
        return "Nothing to recover";
    }

    const summary = parts.join(" | ");
    runtime.log(summary);
    return summary;
};

const initWorkflow = (config: Config) => {
    const http = new HTTPCapability();
    return [handler(http.trigger({}), onHttpTrigger)];
};

export async function main() {
    const runner = await Runner.newRunner<Config>({ configSchema });
    await runner.run(initWorkflow);
}

main();
