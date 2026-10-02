import Link from "next/link";

import { Icon } from "@/components/icon";

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span className="shape-cookie12 grid size-20 place-items-center bg-secondary-container text-on-secondary-container">
        <Icon name="info" className="size-9" />
      </span>
      <h1 className="headline-large">Page not available</h1>
      <p className="text-muted">
        This page does not exist, or you cannot manage LunaEcho in that server.
      </p>
      <Link
        href="/servers"
        className="m3-button inline-flex h-10 items-center gap-2 bg-primary px-5 text-sm font-semibold text-on-primary hover:bg-primary-strong"
      >
        <Icon name="arrowBack" className="-ml-1 size-[18px]" />
        Back to servers
      </Link>
    </section>
  );
}
