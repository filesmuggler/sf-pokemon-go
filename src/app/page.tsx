import { QuestBuilder } from "@/components/QuestBuilder";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
        <header>
          <p className="text-sm font-medium uppercase tracking-widest text-emerald-600">SF Pokémon GO</p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight">SF Side Quest — Fix the City</h1>
          <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
            Pick a spot. A Mistral agent digs through real SF 311 reports in Elasticsearch, filters duplicates, checks what&apos;s
            still open, and hands you a walkable quest: three recurring problems and the one fix that would help most.
          </p>
        </header>

        <QuestBuilder />

        <footer className="mt-auto pt-8 text-xs text-zinc-400">
          Data: SF 311 Cases (data.sfgov.org) · Agent: Mistral · Search: Elasticsearch ·{" "}
          <a className="underline" href="/api/health">
            /api/health
          </a>
        </footer>
      </main>
    </div>
  );
}
