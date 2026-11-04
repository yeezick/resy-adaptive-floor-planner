/** Monochrome thumb glyph in the text colour (emoji read as amber and fade in light theme). */
export function Thumb({ down = false }: { down?: boolean }) {
  return (
    <svg
      className="thumb-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      style={down ? { transform: "rotate(180deg)" } : undefined}
    >
      <path d="M2 7h2.5v7H2zM6 14V7.2l2.6-4.7c.5-.9 1.9-.5 1.9.5V6h3c.9 0 1.6.9 1.4 1.8l-1.1 5c-.2.7-.8 1.2-1.5 1.2z" />
    </svg>
  );
}
