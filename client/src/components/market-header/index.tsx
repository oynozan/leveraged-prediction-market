import type { Market } from "@/lib/types";
import { ExternalLink } from "lucide-react";

interface MarketHeaderProps {
    market: Market;
}

function formatEndDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

export function MarketHeader({ market }: MarketHeaderProps) {
    const yesPrice = Math.round(market.tokens.Yes.price * 100);

    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between px-4 py-2 gap-2 border-b border-border bg-(--surface) shrink-0">
            <div className="flex items-center gap-2 min-w-0">
                <a href={`https://polymarket.com/market/${market.slug}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-primary transition-colors">
                    <span className="text-sm truncate">{market.question}</span>
                    <ExternalLink className="w-3 h-3" />
                </a>
            </div>

            <div className="grid grid-cols-2 md:flex md:items-center gap-x-6 gap-y-1 text-xs shrink-0">
                <div className="flex flex-col md:items-end">
                    <span className="text-muted-foreground">Price</span>
                    <span className="text-foreground">{yesPrice}¢</span>
                </div>
                <div className="flex flex-col md:items-end">
                    <span className="text-muted-foreground">End date</span>
                    <span className="text-foreground">{formatEndDate(market.endDate)}</span>
                </div>
            </div>
        </div>
    );
}
