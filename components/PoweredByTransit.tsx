const TRANSIT_POWERED_BY_LOGO_URL =
  "https://api-doc.transitapp.com/transit-logotype_iOS-dark.png";

export function PoweredByTransit() {
  return (
    <a
      href="https://transitapp.com"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900/60 px-2.5 py-1 text-[10px] text-neutral-400"
      aria-label="Powered by Transit"
    >
      <span>Powered by</span>
      <span
        aria-hidden="true"
        className="inline-block h-3.5 w-12 bg-contain bg-left bg-no-repeat"
        style={{ backgroundImage: `url(${TRANSIT_POWERED_BY_LOGO_URL})` }}
      />
    </a>
  );
}
