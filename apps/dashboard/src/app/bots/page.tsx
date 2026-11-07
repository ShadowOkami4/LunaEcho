import type { CustomBot } from "@lunaecho/modules";
import Image from "next/image";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { Icon } from "@/components/icon";
import { Loader } from "@/components/loader";
import { requireSession } from "@/lib/access";
import { billingAvailable } from "@/lib/billing";
import { maximumBillingSlots } from "@/lib/handoff";
import { botAvatarUrl, customBotInviteUrl } from "@/lib/discord";
import { services } from "@/lib/services";
import { customServersAvailable } from "@/lib/workspace";

import {
  Button,
  buttonClass,
  Card,
  Chip,
  Field,
  inputClass,
  Notice,
} from "../servers/[guildId]/ui";
import {
  addCustomBot,
  changeSlots,
  openBilling,
  removeCustomBot,
  replaceCustomBotToken,
  setCustomBotRunning,
} from "./actions";

export const dynamic = "force-dynamic";

/** What the bot is doing, from what the owner asked for and what the orchestrator reports. */
function BotStatus({ bot }: Readonly<{ bot: CustomBot }>) {
  if (bot.desiredState === "stopped") {
    return bot.status === "stopped" ? <Chip>Stopped</Chip> : <Chip>Stopping</Chip>;
  }

  switch (bot.status) {
    case "running":
      return (
        <Chip tone="success" icon="checkCircle">
          Running
        </Chip>
      );
    case "failed":
      return (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-m3-sm bg-danger-container px-2.5 text-xs font-medium text-on-danger-container">
          <Icon name="error" className="size-4" />
          Failed
        </span>
      );
    default:
      return (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-m3-sm border border-outline px-2.5 text-xs font-medium text-muted">
          <Loader className="size-3.5 text-primary" label="Starting" />
          Starting
        </span>
      );
  }
}

const tokenField = {
  autoComplete: "off",
  className: `${inputClass} font-mono`,
  name: "token",
  placeholder: "Paste the bot token",
  required: true,
  spellCheck: false,
  type: "password",
} as const;

export default async function CustomBotsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ notice?: string }> }>) {
  const session = await requireSession();
  const bots = (await services()).customBots;
  const [grant, owned, sizes] =
    bots === undefined
      ? [undefined, [], undefined]
      : await Promise.all([
          bots.grantFor(session.user.id),
          bots.listOwned(session.user.id),
          bots.sizesFor(session.user.id),
        ]);
  const number = new Intl.NumberFormat("en");
  const changing = owned.some(
    (bot) =>
      (bot.desiredState === "running" && bot.status !== "running" && bot.status !== "failed") ||
      (bot.desiredState === "stopped" && bot.status !== "stopped"),
  );
  const free = grant === undefined ? 0 : Math.max(grant.slots - grant.used, 0);
  const billing = billingAvailable();

  return (
    <section className="flex flex-col gap-8 rounded-m3-xl-inc bg-surface-lowest p-5 shadow-edge sm:p-8">
      {changing && <AutoRefresh />}

      <header className="flex items-start gap-4">
        <span className="shape-cookie9 icon-tile-on grid size-14 shrink-0 place-items-center">
          <Icon name="smartDisplay" className="size-7" />
        </span>
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="headline-large">Custom bots</h1>
          <p className="mt-1.5 text-sm text-muted">
            LunaEcho under your own bot&apos;s name and avatar, with every module and its own
            database.
          </p>
        </div>
      </header>

      <Notice code={(await searchParams).notice} />

      {grant === undefined ? (
        <p className="flex items-center gap-3 rounded-m3-lg bg-surface px-4 py-3 text-sm text-muted">
          <Icon name="info" className="size-5 shrink-0" />
          Custom bots are not set up on this dashboard.
        </p>
      ) : grant.slots === 0 && owned.length === 0 ? (
        <Card
          icon="stars"
          title="Custom is not on your account yet"
          description="With Custom, LunaEcho runs as your own bot: your name, your avatar, Music, Automation, and Social Notifications included."
        >
          <div className="flex flex-wrap gap-2">
            {billing && (
              <form action={openBilling}>
                <input type="hidden" name="action" value="checkout" />
                <Button icon="stars">Get Custom</Button>
              </form>
            )}
            <a href="https://shadowokami.com/LunaEcho" className={buttonClass("outlined")}>
              See the plans
              <Icon name="openInNew" className="-mr-1 size-[18px]" />
            </a>
          </div>
          <p className="text-xs text-faint">
            Billed monthly per bot. You choose how many bots at checkout and can change or cancel
            any time.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
            <span>
              <span className="display text-3xl text-primary">{grant.used}</span> of {grant.slots}{" "}
              {grant.slots === 1 ? "slot" : "slots"} in use
            </span>
            {grant.partner && <Chip tone="tertiary">Partner</Chip>}
            {!grant.partner && sizes.totalAverageMembers > 0 && (
              <span>
                · billed size {number.format(sizes.totalAverageMembers)} members (30-day average) ·{" "}
                <a
                  href="https://shadowokami.com/LunaEcho#pricing"
                  className="text-primary hover:underline"
                >
                  How pricing works
                </a>
              </span>
            )}
            {billing && !grant.partner && grant.slots > 0 && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {/* Stripe's portal cannot change one item of this subscription, so it is here. */}
                <form action={changeSlots} className="flex items-center gap-2">
                  <label className="flex items-center gap-2">
                    <span className="sr-only">Number of bots</span>
                    <select
                      name="slots"
                      defaultValue={grant.slots}
                      className={`${inputClass} w-auto`}
                    >
                      {Array.from({ length: maximumBillingSlots }, (_, index) => index + 1).map(
                        (count) => (
                          <option key={count} value={count}>
                            {count} {count === 1 ? "bot" : "bots"}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <Button tone="neutral" icon="tune">
                    Change
                  </Button>
                </form>
                <form action={openBilling}>
                  <input type="hidden" name="action" value="portal" />
                  <Button tone="outlined" icon="openInNew">
                    Billing
                  </Button>
                </form>
              </div>
            )}
          </div>
          {billing && !grant.partner && grant.slots > 0 && (
            <p className="-mt-5 text-xs text-faint">
              Changing the number of bots is settled right away: more bots are charged for the rest
              of the month, fewer leave a credit for the next invoice. With fewer slots than bots,
              the newest bots stop and keep their settings. Billing has your card, invoices, and
              cancelling.
            </p>
          )}

          {owned.length > 0 && (
            <ul className="flex flex-col">
              {owned.map((bot) => {
                const avatar = botAvatarUrl(bot);
                const running = bot.desiredState === "running";
                const size = sizes.bots.get(bot.id);

                return (
                  <li
                    key={bot.id}
                    className="rise flex flex-col gap-4 border-b border-white/6 py-5 first:pt-0 last:border-0"
                  >
                    <div className="flex flex-wrap items-center gap-4">
                      {avatar === null ? (
                        <span className="shape-cookie9 icon-tile grid size-12 shrink-0 place-items-center font-semibold">
                          {bot.name.slice(0, 2)}
                        </span>
                      ) : (
                        <Image
                          src={avatar}
                          alt=""
                          width={48}
                          height={48}
                          className="shape-cookie9 size-12 shrink-0"
                        />
                      )}
                      <div className="min-w-40 flex-1">
                        <p className="title-medium truncate">{bot.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <BotStatus bot={bot} />
                          {bot.status === "failed" && bot.statusMessage !== null && (
                            <span className="text-sm text-muted">{bot.statusMessage}</span>
                          )}
                        </div>
                        {size !== undefined && (
                          <p className="mt-1 text-xs text-faint">
                            {number.format(size.latestMembers)} members in {size.latestGuilds}{" "}
                            {size.latestGuilds === 1 ? "server" : "servers"} today · 30-day average{" "}
                            {number.format(size.averageMembers)}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {customServersAvailable() && (
                          // Its server settings live in its own database, opened per bot.
                          <Link href={`/bots/${bot.id}`} className={buttonClass("neutral")}>
                            <Icon name="settings" className="-ml-1 size-[18px]" />
                            Servers
                          </Link>
                        )}
                        <a
                          href={customBotInviteUrl(bot.applicationId)}
                          target="_blank"
                          rel="noreferrer"
                          className={buttonClass("outlined")}
                        >
                          <Icon name="groupAdd" className="-ml-1 size-[18px]" />
                          Invite
                        </a>
                        <form action={setCustomBotRunning}>
                          <input type="hidden" name="botId" value={bot.id} />
                          <input type="hidden" name="running" value={String(!running)} />
                          <Button tone="neutral" icon={running ? "powerSettingsNew" : "bolt"}>
                            {running ? "Stop" : "Start"}
                          </Button>
                        </form>
                      </div>
                    </div>

                    <details className="group">
                      <summary className="inline-flex cursor-pointer items-center gap-1 text-sm font-medium text-muted hover:text-on-surface">
                        Token and removal
                        <Icon name="expandMore" className="m3-chevron size-5" />
                      </summary>
                      <div className="grid gap-6 pt-4 md:grid-cols-2">
                        <form action={replaceCustomBotToken} className="flex flex-col gap-3">
                          <input type="hidden" name="botId" value={bot.id} />
                          <Field
                            label="New token"
                            hint="After a reset on Discord. It must belong to the same application."
                          >
                            <input {...tokenField} />
                          </Field>
                          <div>
                            <Button tone="neutral" icon="edit">
                              Replace token
                            </Button>
                          </div>
                        </form>
                        <form action={removeCustomBot} className="flex flex-col gap-3">
                          <input type="hidden" name="botId" value={bot.id} />
                          <p className="text-sm text-muted">
                            Removing stops the bot and deletes its database with every server&apos;s
                            settings. This cannot be undone.
                          </p>
                          <label className="flex items-center gap-3 text-sm">
                            <input type="checkbox" name="confirm" required />
                            Delete {bot.name} and its settings
                          </label>
                          <div>
                            <Button tone="remove" icon="delete">
                              Remove {bot.name}
                            </Button>
                          </div>
                        </form>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}

          {free > 0 && (
            <Card
              icon="add"
              title="Add a bot"
              description={`${free} free ${free === 1 ? "slot" : "slots"}. LunaEcho checks the token with Discord before it stores it.`}
            >
              <ol className="flex flex-col gap-2 text-sm text-muted">
                <li>
                  1. Create an application in the{" "}
                  <a
                    href="https://discord.com/developers/applications"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    Discord Developer Portal
                  </a>{" "}
                  and give it a name and avatar.
                </li>
                <li>
                  2. On its <span className="text-on-surface">Bot</span> page, turn on the Server
                  Members and Message Content intents.
                </li>
                <li>
                  3. Press <span className="text-on-surface">Reset Token</span>, copy the token, and
                  paste it here. Never share it anywhere else.
                </li>
              </ol>
              <form action={addCustomBot} className="flex flex-col gap-3">
                <Field
                  label="Bot token"
                  hint="Stored encrypted; only your bot's own container can read it."
                >
                  <input {...tokenField} />
                </Field>
                <div>
                  <Button icon="add">Add bot</Button>
                </div>
              </form>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
