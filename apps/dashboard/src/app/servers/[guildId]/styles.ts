// Class names shared by server components and client components such as the card designer.

export const inputClass =
  "rounded-m3-md border-b-2 border-outline-strong/60 bg-surface-highest px-3.5 py-2.5 text-sm text-on-surface transition-colors placeholder:text-faint hover:bg-surface-bright focus:border-primary focus:outline-none";

export const textAreaClass = `${inputClass} min-h-28 leading-relaxed`;

const buttonStyles = {
  danger: "bg-danger-container text-on-danger-container hover:brightness-110",
  neutral: "bg-secondary-container text-on-secondary-container hover:brightness-110",
  outlined: "border border-outline-strong text-primary hover:bg-primary/8",
  primary: "bg-primary text-on-primary hover:bg-primary-strong",
  remove: "text-danger hover:bg-danger/10",
  text: "text-primary hover:bg-primary/8",
} as const;

export type ButtonTone = keyof typeof buttonStyles;

export function buttonClass(tone: ButtonTone = "primary"): string {
  return `m3-button inline-flex h-10 items-center justify-center gap-2 px-5 text-sm font-semibold whitespace-nowrap ${buttonStyles[tone]}`;
}
