import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

function createProxyAxios() {
    const proxyUrl = process.env.PROXY_URL;

    if (!proxyUrl) return axios;

    const agent = new HttpsProxyAgent(proxyUrl);

    return axios.create({
        httpAgent: agent,
        httpsAgent: agent,
        proxy: false,
    });
}

export const proxyAxios = createProxyAxios();
