import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

export default function SetupPage() {
  return (
    <main className="mx-auto max-w-xl px-4 pb-20 pt-[max(env(safe-area-inset-top),1rem)]">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-200"
      >
        <ArrowLeft size={16} />
        Back
      </Link>

      <h1 className="text-2xl font-bold">Setup</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Get free API keys, then drop them in <code className="rounded bg-neutral-900 px-1 py-0.5">.env.local</code>
      </p>

      <section className="mt-6 space-y-4">
        <div className="rounded-xl border border-purple-900/40 bg-purple-950/10 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="h-2 w-2 rounded-full bg-purple-500" />
            AnyTrip (no key &mdash; Qcity 830 lives here)
          </h2>
          <p className="mt-2 text-sm text-neutral-300">
            Already enabled. AnyTrip aggregates feeds the official NSW open
            data hub doesn&apos;t expose, including <strong>Qcity Transit</strong>
            (route 830 Googong &harr; Canberra CBD via Queanbeyan). Their public{" "}
            <code className="rounded bg-neutral-900 px-1 text-xs">/vehicles</code>{" "}
            endpoint is what powers the live tracking on{" "}
            <a
              className="text-purple-400 underline"
              href="https://anytrip.com.au"
              target="_blank"
            >
              anytrip.com.au
            </a>{" "}
            and (indirectly){" "}
            <a
              className="text-purple-400 underline"
              href="https://nextthere.com"
              target="_blank"
            >
              nextthere.com
            </a>
            . No registration needed; we cache responses for 10s to be polite.
          </p>
        </div>

        <div className="rounded-xl border border-cyan-900/40 bg-cyan-950/10 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="h-2 w-2 rounded-full bg-cyan-500" />
            Transport Canberra (ACT)
          </h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-300">
            <li>
              Visit{" "}
              <a
                className="text-cyan-400 underline"
                href="https://www.transport.act.gov.au/contact-us/information-for-developers"
                target="_blank"
              >
                transport.act.gov.au/contact-us/information-for-developers
                <ExternalLink size={10} className="ml-0.5 inline" />
              </a>
            </li>
            <li>Download the MyWayPlus GTFS developer access guide (PDF)</li>
            <li>Follow the registration steps (free)</li>
            <li>
              Add to <code className="rounded bg-neutral-900 px-1">.env.local</code>:
              <pre className="mt-1 overflow-x-auto rounded bg-neutral-950 p-2 text-[11px]">
CANBERRA_CLIENT_ID=your_client_id{"\n"}
CANBERRA_CLIENT_SECRET=your_client_secret
              </pre>
            </li>
            <li>Use the same variable names in Vercel environment variables</li>
          </ol>
        </div>

        <div className="rounded-xl border border-orange-900/40 bg-orange-950/10 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="h-2 w-2 rounded-full bg-orange-500" />
            Transport NSW (Queanbeyan / Qcity)
          </h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-300">
            <li>
              Visit{" "}
              <a
                className="text-orange-400 underline"
                href="https://opendata.transport.nsw.gov.au/"
                target="_blank"
              >
                opendata.transport.nsw.gov.au
                <ExternalLink size={10} className="ml-0.5 inline" />
              </a>
            </li>
            <li>Register for a free account (takes 2 min)</li>
            <li>
              Create an app and subscribe to <em>Public Transport - Realtime
              Vehicle Positions</em>
            </li>
            <li>Copy your API key</li>
            <li>
              Add to <code className="rounded bg-neutral-900 px-1">.env.local</code>:
              <pre className="mt-1 overflow-x-auto rounded bg-neutral-950 p-2 text-[11px]">
NSW_API_KEY=your_key_here
              </pre>
            </li>
          </ol>
        </div>

        <div className="rounded-xl border border-blue-900/40 bg-blue-950/10 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            Transit App API (global live departures)
          </h2>
          <p className="mt-2 text-sm text-neutral-300">
            Transit provides real-time departure times and live vehicle positions
            for routes worldwide, including Canberra and Queanbeyan. Select
            &quot;Transit&quot; in the timing source picker to use it for
            departures, or leave on &quot;Auto&quot; to use the best available
            source per route.
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">
            Free tier: 1,500 calls/month, 5 calls/min. The app caches
            aggressively to stay within quota.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-300">
            <li>
              Request access at{" "}
              <a
                className="text-blue-400 underline"
                href="https://transitapp.com/partners/apis"
                target="_blank"
              >
                transitapp.com/partners/apis
                <ExternalLink size={10} className="ml-0.5 inline" />
              </a>
            </li>
            <li>
              Add to <code className="rounded bg-neutral-900 px-1">.env.local</code>:
              <pre className="mt-1 overflow-x-auto rounded bg-neutral-950 p-2 text-[11px]">
TRANSIT_API_KEY=your_key_here
              </pre>
            </li>
          </ol>
          <p className="mt-2 text-[10px] text-neutral-500">
            Per Transit&apos;s Terms of Service, the &quot;Powered by
            Transit&quot; attribution is displayed when Transit data is shown.
          </p>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-400">
          <p className="font-semibold text-neutral-200">After adding keys:</p>
          <ol className="mt-1 list-decimal pl-5">
            <li>
              Stop and restart the dev server (
              <code className="rounded bg-neutral-800 px-1 text-xs">npm run dev</code>
              )
            </li>
            <li>Reload this app — keys take effect immediately</li>
            <li>
              On Vercel: add the same names under{" "}
              <em>Settings → Environment Variables</em>
            </li>
          </ol>
        </div>
      </section>
    </main>
  );
}
