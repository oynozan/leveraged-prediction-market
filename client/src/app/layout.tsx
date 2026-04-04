import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

const manrope = Manrope({
    variable: "--font-manrope",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Pred",
    description: "Leveraged prediction markets",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className={`${manrope.variable} dark h-full antialiased`}>
            <body className="min-h-full flex flex-col">
                <Navbar />
                <main className="flex-1 min-h-0 flex flex-col">{children}</main>
                <Footer />
            </body>
        </html>
    );
}
