"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";

const navLinks = [
    { label: "Markets", href: "/markets" },
    { label: "Trade", href: "/trade" },
    { label: "Portfolio", href: "/portfolio" },
    { label: "LP Dashboard", href: "/lp" },
];

function isActive(pathname: string, href: string) {
    if (href === "/trade") return pathname.startsWith("/trade");
    return pathname === href;
}

export function Navbar() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const pathname = usePathname();

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
                    <button className="px-3.5 py-1.5 text-sm rounded border border-primary text-primary hover:bg-primary/10 transition-colors">
                        Deposit
                    </button>
                    <button className="hidden sm:block px-3.5 py-1.5 text-sm rounded bg-card text-muted-foreground hover:text-foreground transition-colors">
                        0xad...AbD1
                    </button>
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
                        <button className="sm:hidden px-3.5 py-2.5 text-sm rounded text-left text-muted-foreground hover:text-foreground transition-colors">
                            0xad...AbD1
                        </button>
                    </nav>
                </div>
            )}
        </header>
    );
}
