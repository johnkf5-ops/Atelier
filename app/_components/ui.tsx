/**
 * Shared visual primitives. Every page renders through these so the
 * design system stays coherent. See lib/ui/design-system.md for tokens.
 */

import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}) {
  const base =
    'inline-flex items-center justify-center gap-2 font-sans rounded transition disabled:opacity-40 disabled:cursor-not-allowed';
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  };
  const variants = {
    primary: 'bg-neutral-100 text-neutral-900 hover:bg-white',
    secondary: 'border border-neutral-700 text-neutral-100 hover:bg-neutral-900 hover:border-neutral-600',
    ghost: 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900',
    danger: 'border border-rose-500/50 text-rose-200 hover:bg-rose-500/10',
  };
  return <button {...rest} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} />;
}

export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
}: {
  href: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  className?: string;
  children: ReactNode;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 font-sans rounded transition no-underline';
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  };
  const variants = {
    primary: 'bg-neutral-100 text-neutral-900 hover:bg-white',
    secondary:
      'border border-neutral-700 text-neutral-100 hover:bg-neutral-900 hover:border-neutral-600',
    ghost: 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900',
  };
  return (
    <Link href={href} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-neutral-800 bg-[#171717] ${
        padded ? 'p-5' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
}) {
  const variants = {
    neutral: 'border-neutral-700 bg-neutral-800/50 text-neutral-300',
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    warning: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    danger: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    info: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] uppercase tracking-wide rounded border ${variants[variant]}`}
    >
      {children}
    </span>
  );
}

export function Skeleton({
  className = '',
  width,
  height = '1rem',
}: {
  className?: string;
  width?: string;
  height?: string;
}) {
  return <div className={`skeleton ${className}`} style={{ width, height }} aria-hidden />;
}

export function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body?: string;
  cta?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-800 p-10 text-center space-y-3">
      <h3 className="font-serif text-xl text-neutral-200">{title}</h3>
      {body && <p className="text-sm text-neutral-400 max-w-md mx-auto">{body}</p>}
      {cta && <div className="pt-2">{cta}</div>}
    </div>
  );
}

export function Prose({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`font-serif text-neutral-200 text-base leading-[1.65] space-y-4 prose-narrow ${className}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="space-y-2 mb-8">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          {eyebrow && (
            <div className="text-[11px] uppercase tracking-widest text-neutral-500">{eyebrow}</div>
          )}
          <h1 className="font-serif text-3xl tracking-tight text-neutral-100">{title}</h1>
        </div>
        {action}
      </div>
      {subtitle && <p className="text-sm text-neutral-400 max-w-2xl">{subtitle}</p>}
    </header>
  );
}
