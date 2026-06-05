/**
 * Small UI primitives — buttons, dialogs, tooltips, icons.
 * All consumers should import from `@/components/ui/...`.
 */

import { type ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}>(({ variant = "ghost", className, ...rest }, ref) => (
  <button
    ref={ref}
    className={clsx(
      variant === "primary" && "btn-primary",
      variant === "danger" && "btn-danger",
      variant === "ghost" && "btn-ghost",
      className,
    )}
    {...rest}
  />
));
Button.displayName = "Button";

export function Pill({
  children,
  tone = "default",
  className,
  title,
}: {
  children: React.ReactNode;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={clsx(
        tone === "default" && "pill",
        tone === "accent" && "pill-accent",
        tone === "success" && "pill-success",
        tone === "warning" && "pill-warning",
        tone === "danger" && "pill-danger",
        className,
      )}
      title={title}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className,
  interactive,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={clsx(
        "card",
        interactive && "card-hover",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
