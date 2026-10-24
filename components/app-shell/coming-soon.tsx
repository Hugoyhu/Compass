export function ComingSoon({ title }: { title: string }) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-12">
      <h2 className="text-5xl font-bold tracking-tight md:text-6xl">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Coming soon.</p>
    </main>
  );
}
