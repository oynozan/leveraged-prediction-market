"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { cn } from "@/lib/utils";
import { useUsdcBalance } from "@/hooks/use-usdc-balance";
import { Menu, X, LogOut } from "lucide-react";

const navLinks = [
    { label: "Trade", href: "/" },
    { label: "Portfolio", href: "/portfolio" },
    { label: "LP Dashboard", href: "/lp" },
];

function formatUsdcDisplay(raw: string): string {
    const num = parseFloat(raw);
    return num.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function isActive(pathname: string, href: string) {
    if (href === "/trade") return pathname.startsWith("/trade");
    return pathname === href;
}

function truncateAddress(address: string) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function Navbar() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const pathname = usePathname();
    const { ready, authenticated, login, logout, user } = usePrivy();

    const walletAddress = user?.wallet?.address;
    const usdcBalance = useUsdcBalance(walletAddress);

    return (
        <header className="border-b border-border bg-(--surface) relative shrink-0">
            <div className="flex items-center justify-between px-5 h-14">
                <div className="flex items-center gap-7">
                    <Link href="/" className="flex items-center gap-2.5">
                        <span className="text-sm font-bold tracking-[-0.01em] text-foreground">
                            Pred
                        </span>
                    </Link>

                    <nav className="hidden md:flex items-center gap-1">
                        {navLinks.map(link => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    "px-3.5 py-1.5 text-sm rounded transition-colors",
                                    isActive(pathname, link.href)
                                        ? "text-primary bg-primary/10"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {link.label}
                            </Link>
                        ))}
                    </nav>
                </div>

                <div className="flex items-center gap-2.5">
                    <Link
                        href="/deposit"
                        className="px-3.5 py-1.5 text-sm rounded border border-primary text-primary hover:bg-primary/10 transition-colors"
                    >
                        Deposit
                    </Link>

                    {ready && authenticated && walletAddress && usdcBalance !== null && (
                        <div className="hidden sm:flex items-center bg-card px-3 py-1.5 rounded text-sm text-foreground">
                            {formatUsdcDisplay(usdcBalance)}
                        </div>
                    )}

                    {ready && authenticated && walletAddress ? (
                        <button
                            onClick={logout}
                            className="hidden sm:flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded bg-card text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {truncateAddress(walletAddress)}
                            <LogOut className="w-3.5 h-3.5" />
                        </button>
                    ) : (
                        <button
                            onClick={login}
                            disabled={!ready}
                            className="hidden sm:block px-3.5 py-1.5 text-sm rounded bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                            Connect Wallet
                        </button>
                    )}

                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="md:hidden p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            {mobileMenuOpen && (
                <div className="md:hidden border-t border-border bg-(--surface) absolute left-0 right-0 z-50">
                    <nav className="flex flex-col p-2">
                        {navLinks.map(link => (
                            <Link
                                key={link.href}
                                href={link.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={cn(
                                    "px-3.5 py-2.5 text-sm rounded text-left transition-colors",
                                    isActive(pathname, link.href)
                                        ? "text-primary bg-primary/10"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {link.label}
                            </Link>
                        ))}

                        {ready && authenticated && walletAddress ? (
                            <button
                                onClick={() => { logout(); setMobileMenuOpen(false); }}
                                className="sm:hidden px-3.5 py-2.5 text-sm rounded text-left text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                            >
                                {truncateAddress(walletAddress)}
                                <LogOut className="w-3.5 h-3.5" />
                            </button>
                        ) : (
                            <button
                                onClick={() => { login(); setMobileMenuOpen(false); }}
                                disabled={!ready}
                                className="sm:hidden px-3.5 py-2.5 text-sm rounded text-left text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                            >
                                Connect Wallet
                            </button>
                        )}
                    </nav>
                </div>
            )}
        </header>
    );
}
