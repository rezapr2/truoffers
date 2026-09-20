import type { ReactNode } from 'react';

/**
 * The green band that carries on from the top bar at the head of a viewer page —
 * the same block the home hero uses, at listing-page height.
 */
export default function PageHero({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="bg-brand-deep hero-pattern text-white rounded-b-[2rem] md:rounded-b-[2.5rem]">
      <div className="mx-auto max-w-7xl px-5 md:px-10 pt-8 pb-10 md:pt-10 md:pb-14">
        <h1 className="font-display text-[30px] md:text-[42px] font-extrabold tracking-tight leading-[1.1]">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[14.5px] text-leaf-soft/85 mt-3 max-w-xl leading-relaxed">{subtitle}</p>
        )}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </section>
  );
}
