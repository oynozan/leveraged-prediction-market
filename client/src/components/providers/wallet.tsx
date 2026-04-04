"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { polygon, mainnet, bsc, arbitrum } from "viem/chains";

export default function WalletProvider({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <PrivyProvider
            appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
            clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID!}
            config={{
                appearance: {
                    accentColor: "#42D166",
                    theme: "#0a0a0a",
                    showWalletLoginFirst: false,
                    walletChainType: "ethereum-only",
                    walletList: [
                        "detected_ethereum_wallets",
                        "metamask",
                        "coinbase_wallet",
                        "rainbow",
                        "wallet_connect",
                    ],
                },
                loginMethods: ["wallet"],
                embeddedWallets: {
                    showWalletUIs: true,
                    ethereum: {
                        createOnLogin: "users-without-wallets",
                    },
                },
                defaultChain: polygon,
                supportedChains: [polygon, mainnet, bsc, arbitrum],
            }}
        >
            {children}
        </PrivyProvider>
    );
}
