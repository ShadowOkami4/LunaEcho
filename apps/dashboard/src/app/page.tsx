import Image from "next/image";
import { redirect } from "next/navigation";

import { delay } from "@/lib/motion";
import { getActiveSession } from "@/lib/session";

const highlights = ["11 modules", "Open source", "Settings in one place"] as const;

export default async function HomePage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
  if ((await getActiveSession()) !== undefined) {
    redirect("/servers");
  }

  const { error } = await searchParams;

  return (
    <section className="grid items-center gap-10 py-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
      {/* The arched visual of the product page, with a slowly morphing shape behind the cat. */}
      <figure className="rise relative grid min-h-[340px] place-items-center overflow-hidden rounded-t-[160px] rounded-b-m3-xxl bg-surface sm:min-h-[460px]">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,color-mix(in_srgb,var(--color-tertiary)_20%,transparent),transparent_32%),radial-gradient(circle_at_75%_72%,color-mix(in_srgb,var(--color-primary)_20%,transparent),transparent_36%)]"
        />
        <div aria-hidden className="shape-morph absolute size-[78%] max-w-[420px] bg-primary/10" />
        <Image
          src="/lunaecho-logo.png"
          alt="LunaEcho cat bot logo with a pink and blue orbit"
          width={1600}
          height={1321}
          priority
          className="relative w-[min(78%,360px)]"
        />
        <figcaption className="label absolute bottom-6 text-faint">
          Dashboard / Pre-release
        </figcaption>
      </figure>

      <div className="flex flex-col items-start">
        <p className="label rise mb-4 inline-flex items-center gap-3 text-primary">
          <span className="shape-cookie6 grid size-9 place-items-center bg-primary-container text-on-primary-container">
            ✦
          </span>
          Server dashboard
        </p>
        <h1
          className="display rise text-[clamp(4.2rem,11vw,8.5rem)] leading-[0.86] uppercase"
          style={delay(60)}
        >
          Luna<span className="outline-text">Echo</span>
        </h1>
        <p
          className="display rise mt-5 text-[clamp(1.3rem,2.2vw,1.7rem)] text-primary"
          style={delay(120)}
        >
          One bot. Every community tool. Your way.
        </p>
        <p className="rise mt-4 max-w-xl text-muted" style={delay(180)}>
          Sign in with Discord to choose which modules run in your servers and how they behave. You
          can manage every server where you have the Manage Server permission.
        </p>

        {error === "login" && (
          <p className="mt-6 flex items-center gap-3 rounded-m3-lg bg-danger-container px-5 py-3 text-sm text-on-danger-container">
            <span aria-hidden className="shape-cookie4 size-3 bg-danger" />
            The Discord login did not complete. Please try again.
          </p>
        )}

        <div className="rise mt-8 flex flex-wrap items-center gap-3" style={delay(240)}>
          <a
            href="/api/auth/login"
            className="m3-button inline-flex h-14 items-center gap-3 bg-primary px-7 text-base font-bold text-on-primary hover:bg-primary-strong"
          >
            <DiscordMark />
            Sign in with Discord
          </a>
          <a
            href="https://shadowokami.com/LunaEcho"
            className="m3-button inline-flex h-14 items-center bg-secondary-container px-7 font-semibold text-on-secondary-container hover:bg-secondary-container/80"
          >
            What is LunaEcho?
          </a>
        </div>

        <ul className="rise mt-8 flex flex-wrap gap-2" style={delay(300)}>
          {highlights.map((highlight) => (
            <li
              key={highlight}
              className="label rounded-full bg-surface-high px-3.5 py-2 text-muted"
            >
              {highlight}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-faint">
          LunaEcho reads your username, avatar, and server list. It never sees your password.
        </p>
      </div>
    </section>
  );
}

function DiscordMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="currentColor">
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.61 1.25a18.27 18.27 0 0 0-5.49 0 12.6 12.6 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.88 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.05 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1 0-.12l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.8 8.18 1.8 12.06 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1 0 .12c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.36 1.23 1.99a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42Z" />
    </svg>
  );
}
