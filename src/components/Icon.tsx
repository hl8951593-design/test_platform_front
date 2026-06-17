export function Icon({ name, className = "" }: { name: string; className?: string }) {
  const classes = [
    "material-symbols-outlined",
    name === "progress_activity" ? "icon-spin" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <span aria-hidden="true" className={classes}>
      {name}
    </span>
  );
}
