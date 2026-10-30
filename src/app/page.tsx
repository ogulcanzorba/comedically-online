import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-neutral-950">
      {/* Warm stage spotlight cone */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 45% at 50% -5%, rgba(255, 214, 140, 0.22), transparent 70%), radial-gradient(ellipse 30% 22% at 50% 38%, rgba(255, 214, 140, 0.1), transparent 70%)',
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
        <p className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-200/30 bg-amber-100/10 px-3 py-1 text-xs text-amber-100">
          Test build: demo video coming soon
        </p>

        <div className="flex flex-1 flex-col justify-center py-16">
          <p className="text-sm font-medium tracking-wide text-amber-200/80">Comedically Online</p>
          <h1 className="mt-3 font-serif text-5xl leading-tight sm:text-6xl">
            Live comedy.
            <br />
            <span className="text-neutral-300">Moderated by someone who gets the joke.</span>
          </h1>
          <p className="mt-5 max-w-xl text-neutral-400">
            One stage, one stream, ten seconds of broadcast delay. Jokes stay up; only the
            genuinely problematic word or pixel gets covered.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/watch"
              className="rounded-md bg-amber-300 px-6 py-3 font-semibold text-neutral-950 hover:bg-amber-200"
            >
              Watch live
            </Link>
            <Link
              href="/studio"
              className="rounded-md border border-neutral-600 px-6 py-3 font-semibold text-neutral-100 hover:border-neutral-400"
            >
              Go live as a comedian
            </Link>
          </div>
        </div>

        <footer className="text-xs text-neutral-500">
          Hackathon MVP: single stream, mock tickets, harmless demo stand-ins only.
        </footer>
      </div>
    </main>
  );
}
