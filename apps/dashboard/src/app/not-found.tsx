import Link from "next/link";

export default function NotFound() {
  return (
    <section className="rise mx-auto flex max-w-xl flex-col items-center gap-6 py-16 text-center">
      <div className="relative grid size-40 place-items-center">
        <div aria-hidden className="shape-morph absolute inset-0 bg-primary-container/25" />
        <span className="display relative text-6xl text-primary">404</span>
      </div>
      <h1 className="display text-[clamp(2.4rem,6vw,3.6rem)]">Not available</h1>
      <p className="text-muted">
        This page does not exist, or you cannot manage LunaEcho in that server.
      </p>
      <Link
        href="/servers"
        className="m3-button inline-flex h-12 items-center bg-primary px-6 font-semibold text-on-primary hover:bg-primary-strong"
      >
        Back to your servers
      </Link>
    </section>
  );
}
