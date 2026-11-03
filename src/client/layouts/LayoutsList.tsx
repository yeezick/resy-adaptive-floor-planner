import type { Room } from "../../domain";
import type { LayoutsApi } from "./useLayouts";

interface Props {
  layouts: LayoutsApi;
  onEdit: (room: Room, name: string, id: string) => void;
}

/** Base layout plus saved one-day variants. The base is always there to go back to. */
export function LayoutsList({ layouts, onEdit }: Props) {
  return (
    <section aria-label="Layouts" className="layouts">
      <h3 className="section-title">Layouts</h3>
      <ul className="layout-list">
        {layouts.layouts.map((l) => {
          const active = l.id === layouts.active.id;
          return (
            <li key={l.id} className={active ? "is-active" : undefined}>
              <div className="layout-name">
                <strong>{l.name}</strong>
                <span className="muted small">
                  {l.kind === "base" ? "base · always restorable" : "one-day variant"}
                  {l.date ? ` · ${l.date}` : ""}
                  {l.shift ? ` · ${l.shift}` : ""}
                </span>
              </div>
              <div className="btn-row">
                {active ? (
                  <span className="pill pill-accent">In use</span>
                ) : (
                  <button type="button" onClick={() => layouts.select(l.id)}>
                    Use
                  </button>
                )}
                <button type="button" onClick={() => onEdit(l.room, l.name, l.id)}>
                  Edit
                </button>
                {l.kind === "variant" && (
                  <button
                    type="button"
                    aria-label={`Delete ${l.name}`}
                    onClick={() => layouts.remove(l.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
