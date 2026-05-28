export function Footer() {
  return (
    <footer className="relative z-10 w-full px-6 py-4 border-t border-border/60 text-xs text-muted-foreground flex items-center justify-between shrink-0 bg-background/70 backdrop-blur">
      <a
        href="https://x.com/officialbunnyos"
        target="_blank"
        rel="noreferrer"
        aria-label="bunnyOS on X"
        className="inline-flex items-center gap-2 font-mono hover:text-foreground transition-colors"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-3.5 w-3.5 fill-current"
        >
          <path d="M18.244 2H21l-6.51 7.44L22 22h-6.828l-4.77-6.24L4.8 22H2l6.96-7.96L2 2h6.914l4.31 5.71L18.244 2Zm-2.39 18h1.69L7.27 4H5.46l10.394 16Z" />
        </svg>
        @officialbunnyos
      </a>
      <span className="font-mono flex items-center gap-3">
        <span>v0.1</span>
      </span>
    </footer>
  );
}
