import fs from "fs";
import path from "path";
import axios, { type AxiosRequestConfig } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

const PROXY_FILE = path.join(__dirname, "..", "proxy.txt");
const MAX_RETRIES = 5;

let proxies: string[] = [];
let currentIndex = 0;

function loadProxies() {
    try {
        const raw = fs.readFileSync(PROXY_FILE, "utf-8");
        proxies = raw
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.startsWith("#"));
        console.log(`[proxy] Loaded ${proxies.length} proxies`);
    } catch {
        proxies = [];
    }
}

loadProxies();

function getNextProxy(): string | null {
    if (proxies.length === 0) return null;
    const proxy = proxies[currentIndex % proxies.length];
    currentIndex++;
    return proxy;
}

function toProxyUrl(raw: string): string {
    if (raw.includes("://")) return raw;

    const parts = raw.split(":");
    if (parts.length === 4) {
        const [host, port, user, pass] = parts;
        return `http://${user}:${pass}@${host}:${port}`;
    }
    if (parts.length === 2) {
        return `http://${raw}`;
    }
    return `http://${raw}`;
}

function extractError(err: unknown): string {
    if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.error || err.response?.data?.message || err.message;
        return String(msg);
    }
    return err instanceof Error ? err.message : String(err);
}

function maskProxy(raw: string): string {
    const parts = raw.split(":");
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
    return raw.slice(0, 20);
}

async function requestWithRetry(
    method: "get" | "post" | "put" | "delete" | "patch",
    args: any[],
): Promise<any> {
    const hasBody = method === "post" || method === "put" || method === "patch";
    const configIdx = hasBody ? 2 : 1;
    const retries = Math.min(MAX_RETRIES, proxies.length || 1);

    for (let attempt = 0; attempt < retries; attempt++) {
        const proxyRaw = process.env.PROXY_URL || getNextProxy();
        const clonedArgs = [...args];

        if (proxyRaw) {
            const agent = new HttpsProxyAgent(toProxyUrl(proxyRaw));
            if (!clonedArgs[configIdx]) clonedArgs[configIdx] = {};
            clonedArgs[configIdx] = {
                ...clonedArgs[configIdx],
                httpAgent: agent,
                httpsAgent: agent,
                proxy: false,
            };
        }

        try {
            return await (axios as any)[method](...clonedArgs);
        } catch (err) {
            const msg = extractError(err);
            const label = proxyRaw ? maskProxy(proxyRaw) : "direct";
            console.error(`[proxy] Attempt ${attempt + 1}/${retries} failed (${label}): ${msg}`);

            // Don't retry if it's not a geoblock / proxy error
            if (axios.isAxiosError(err)) {
                const status = err.response?.status;
                const isGeoblock = msg.includes("restricted") || msg.includes("geoblock");
                const isProxyErr = !err.response || status === 403 || status === 407;
                if (!isGeoblock && !isProxyErr) throw err;
            }

            if (attempt === retries - 1) throw err;
        }
    }
}

export const proxyAxios = {
    get: (url: string, config?: AxiosRequestConfig) =>
        requestWithRetry("get", [url, config]),
    post: (url: string, data?: any, config?: AxiosRequestConfig) =>
        requestWithRetry("post", [url, data, config]),
    put: (url: string, data?: any, config?: AxiosRequestConfig) =>
        requestWithRetry("put", [url, data, config]),
    delete: (url: string, config?: AxiosRequestConfig) =>
        requestWithRetry("delete", [url, config]),
    patch: (url: string, data?: any, config?: AxiosRequestConfig) =>
        requestWithRetry("patch", [url, data, config]),
};

export function reloadProxies() {
    loadProxies();
}
