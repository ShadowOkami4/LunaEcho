import Image from "next/image";
import { redirect } from "next/navigation";

import { Icon, type IconName } from "@/components/icon";
import { getActiveSession } from "@/lib/session";

const features: readonly Readonly<{ icon: IconName; text: string; title: string }>[] = [
  {
    icon: "dashboard",
    text: "Switch modules on per server; only what you enable runs.",
    title: "Eleven modules, one bot",
  },
  {
    icon: "shield",
    text: "AutoMod, cases, and logs keep your community safe.",
    title: "Moderation built in",
  },
  {
    icon: "bolt",
    text: "Changes reach the bot within seconds, without restarts.",
    title: "Applied right away",
  },
];

export default async function HomePage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
  if ((await getActiveSession()) !== undefined) {
    redirect("/servers");
  }

  const { error } = await searchParams;

  return (
    <section className="mx-auto grid max-w-5xl overflow-hidden rounded-m3-xxl border border-outline/50 bg-surface-low lg:grid-cols-2">
      {/* Brand panel with the product page's two-colour glow behind the logo. */}
      <div className="relative grid min-h-72 place-items-center overflow-hidden bg-surface p-10">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,color-mix(in_srgb,var(--color-tertiary)_16%,transparent),transparent_40%),radial-gradient(circle_at_75%_75%,color-mix(in_srgb,var(--color-primary)_16%,transparent),transparent_45%)]"
        />
        <div aria-hidden className="shape-morph absolute size-72 bg-primary/10" />
        <Image
          src="/lunaecho-logo.png"
          alt="LunaEcho logo"
          width={1600}
          height={1321}
          priority
          className="relative w-56"
        />
      </div>

      <div className="flex flex-col gap-6 p-8 sm:p-10">
        <div>
          <p className="text-sm font-medium text-primary">LunaEcho Dashboard</p>
          <h1 className="headline-large mt-1">Sign in to manage your servers</h1>
          <p className="mt-2 text-muted">
            Configure modules, moderation, and community features for every server where you have
            the Manage Server permission.
          </p>
        </div>

        {error === "login" && (
          <p
            role="alert"
            className="flex items-center gap-3 rounded-m3-lg bg-danger-container px-4 py-3 text-sm text-on-danger-container"
          >
            <Icon name="error" className="size-5" />
            The Discord login did not complete. Please try again.
          </p>
        )}

        <a
          href="/api/auth/login"
          className="m3-button inline-flex h-12 items-center justify-center gap-3 bg-primary px-6 font-semibold text-on-primary hover:bg-primary-strong"
        >
          <Icon name="login" className="size-5" />
          Continue with Discord
        </a>

        <ul className="flex flex-col gap-4 border-t border-outline/60 pt-6">
          {features.map((feature) => (
            <li key={feature.title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary-container text-on-secondary-container">
                <Icon name={feature.icon} className="size-5" />
              </span>
              <div>
                <p className="title-medium">{feature.title}</p>
                <p className="text-sm text-muted">{feature.text}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="text-xs text-faint">
          LunaEcho reads your username, avatar, and server list. It never sees your password.
        </p>
      </div>
    </section>
  );
}
