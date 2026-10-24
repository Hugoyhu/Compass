export function ComingSoon({ title }: { title: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl p-4 md:p-6">
      <h2 className="text-3xl font-normal tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Coming soon.</p>
    </main>
  );
}
