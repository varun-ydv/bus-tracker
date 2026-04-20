"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const BusMap = dynamic(() => import("@/components/BusMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[100dvh] items-center justify-center text-sm text-neutral-400">
      Loading map…
    </div>
  ),
});

export default function MapPage() {
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-neutral-950">
      <Link
        href="/"
        className="absolute left-3 z-[1000] flex items-center gap-1.5 rounded-full bg-neutral-900/90 px-3 py-2 text-sm font-medium text-neutral-100 shadow-lg backdrop-blur hover:bg-neutral-800"
        style={{ top: "max(env(safe-area-inset-top), 0.75rem)" }}
      >
        <ArrowLeft size={16} />
        Back
      </Link>
      <BusMap />
    </main>
  );
}
